import { expect } from 'chai';
import { EC2Client, DescribeInstancesCommand, DescribeInstancesCommandOutput } from '@aws-sdk/client-ec2';
import {
  GetBucketEncryptionCommand,
  GetBucketPolicyStatusCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  ListBucketsCommand,
  ListBucketsCommandOutput,
  ListObjectsCommand,
  ListObjectsCommandOutput,
  S3Client,
  Tag,
} from '@aws-sdk/client-s3';
import axios, { type AxiosResponse } from 'axios';
import { readFileSync } from 'fs';
import { Client } from 'ssh2';
import { join } from 'path';
import { BaseConfig } from '../../BaseConfig';

const { accessKeyId, secretAccessKey, region } = BaseConfig;

describe('S3 deployment validation', () => {
  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const s3Client: S3Client = new S3Client({ region });

  let publicIpAddress: string = null;
  let publicDnsName: string = null;

  const bucketPrefix: string = 'cloudximage-imagestorebucket';

  before(async () => {
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const data: DescribeInstancesCommandOutput = await ec2Client.send(new DescribeInstancesCommand(params));

    const deployedInstances: any[] = data.Reservations.reduce((acc, reservation) => {
      return acc.concat(
        reservation.Instances.map((instance) => ({
          id: instance.InstanceId,
          type: instance.PublicIpAddress ? 'public' : 'private',
          instanceType: instance.InstanceType,
          tags: instance.Tags,
          rootBlockDeviceSize: instance.BlockDeviceMappings[0]?.Ebs,
          os: instance,
        })),
      );
    }, []);

    const publicInstance: any = deployedInstances.find((instance) => instance.type === 'public');

    ({ PublicIpAddress: publicIpAddress, PublicDnsName: publicDnsName } = publicInstance.os);
  });

  it('the application should be deployed in the public subnet and should be accessible by HTTP', async () => {
    // should be accessible via public IP address
    const responsePublicIpAddress: AxiosResponse = await axios.get(`http://${publicIpAddress}/api/image`);
    expect(responsePublicIpAddress.status, 'Get public IP address response status is not correct').to.equal(200);

    // should be accessible via public DNS Name
    const responsePublicDnsName: AxiosResponse = await axios.get(`http://${publicDnsName}/api/image`);
    expect(responsePublicDnsName.status, 'Get public DNS Name response status is not correct').to.equal(200);
  });

  it('the application instance should be accessible by SSH protocol', async () => {
    const privateKeyPath: string = join(process.cwd(), 'credentials', 'cloudximage-us-east-1.pem');
    const privateKey: string = readFileSync(privateKeyPath, 'utf8');

    const configuration: { [key: string]: string | number } = {
      host: publicIpAddress,
      port: 22,
      username: 'ec2-user',
      privateKey,
    };

    const client: Client = new Client();

    async function connectClient(conn: any, config: any) {
      return new Promise((resolve, reject) => {
        conn
          .on('ready', () => {
            // eslint-disable-next-line no-console
            console.log('SSH connection successful');
            resolve(conn);
          })
          .on('error', (error: Error) => {
            // eslint-disable-next-line no-console
            console.error('Error:', error.message);
            reject(error);
          })
          .connect(config);
      });
    }

    async function execCommand(conn: any, command: any) {
      return new Promise((resolve, reject) => {
        conn.exec(command, (error: Error, stream: any) => {
          if (error) reject(error);

          stream.on('data', (data: any) => {
            // eslint-disable-next-line no-console
            console.log('Command Output:', data.toString());
            resolve(data.toString());
          });
        });
      });
    }

    try {
      const connectedClient = await connectClient(client, configuration);
      const commandOutput = await execCommand(connectedClient, 'whoami');
      client.end();
      expect(connectedClient, 'The application instance is not accessible by SSH protocol').to.be.instanceOf(Client);
      expect(commandOutput, 'The command should return username').to.include('ec2-user');
    } catch (error) {
      client.end();
      expect.fail(`Error in SSH connection: ${JSON.stringify(error)}`);
    }
  });

  it('the application should have access to the S3 bucket via an IAM role', async () => {
    const listBucketsCommand: ListBucketsCommand = new ListBucketsCommand({});
    const listBucketsData: ListBucketsCommandOutput = await s3Client.send(listBucketsCommand);
    const bucketName: string = listBucketsData.Buckets.find((bucket) => bucket.Name.startsWith(bucketPrefix))?.Name;

    if (!bucketName) throw new Error(`No S3 bucket found with prefix: ${bucketPrefix}`);

    try {
      const response: ListObjectsCommandOutput = await s3Client.send(new ListObjectsCommand({ Bucket: bucketName }));
      expect(response.Name, 'Bucket name is not correct').to.contains(bucketPrefix);
    } catch (error) {
      expect.fail('Error accessing S3 bucket');
    }
  });

  it('should return S3 bucket data', async () => {
    const listBucketsCommand: ListBucketsCommand = new ListBucketsCommand({});
    const listBucketsData: ListBucketsCommandOutput = await s3Client.send(listBucketsCommand);
    const bucketName: string = listBucketsData.Buckets.find((bucket) => bucket.Name.startsWith(bucketPrefix))?.Name;

    if (!bucketName) throw new Error(`No S3 bucket found with prefix: ${bucketPrefix}`);

    // Check bucket tags
    const getBucketTaggingCommand: GetBucketTaggingCommand = new GetBucketTaggingCommand({ Bucket: bucketName });
    const { TagSet } = await s3Client.send(getBucketTaggingCommand);
    expect(
      TagSet.some((tag: Tag) => tag.Key === 'cloudx'),
      'There is no bucket tag with name "cloudx"',
    ).to.be.true;

    // Check bucket encryption
    const getBucketEncryptionCommand: GetBucketEncryptionCommand = new GetBucketEncryptionCommand({
      Bucket: bucketName,
    });
    const { ServerSideEncryptionConfiguration } = await s3Client.send(getBucketEncryptionCommand);
    expect(
      ServerSideEncryptionConfiguration.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
      'SSE S3 Algorithm is not correct',
    ).to.equal('AES256');

    // Check bucket versioning
    const getBucketVersioningCommand: GetBucketVersioningCommand = new GetBucketVersioningCommand({
      Bucket: bucketName,
    });
    const { Status } = await s3Client.send(getBucketVersioningCommand);
    expect(Status === undefined || Status === 'Suspended', 'Bucket versioning is not correct').to.be.true;

    // Check bucket public access
    const getPublicAccessBlockCommand: GetPublicAccessBlockCommand = new GetPublicAccessBlockCommand({
      Bucket: bucketName,
    });
    const getBucketPolicyStatusCommand: GetBucketPolicyStatusCommand = new GetBucketPolicyStatusCommand({
      Bucket: bucketName,
    });

    const { PublicAccessBlockConfiguration } = await s3Client.send(getPublicAccessBlockCommand);
    const { PolicyStatus } = await s3Client.send(getBucketPolicyStatusCommand);

    const hasPublicAccess: boolean =
      PublicAccessBlockConfiguration.BlockPublicAcls &&
      PublicAccessBlockConfiguration.IgnorePublicAcls &&
      PublicAccessBlockConfiguration.BlockPublicPolicy &&
      PublicAccessBlockConfiguration.RestrictPublicBuckets &&
      PolicyStatus.IsPublic === false;

    expect(hasPublicAccess, 'Bucket has no public access').to.be.true;
  });
});
