import { expect } from 'chai';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  GetBucketEncryptionCommand,
  GetBucketPolicyStatusCommand,
  GetBucketTaggingCommand,
  GetBucketVersioningCommand,
  GetPublicAccessBlockCommand,
  ListBucketsCommand,
  ListObjectsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import { readFileSync } from 'fs';
import { Client } from 'ssh2';
import { join } from 'path';
import { BaseConfig } from '../../BaseConfig';

const { accessKeyId, secretAccessKey, region } = BaseConfig;

describe('S3 deployment validation', () => {
  const ec2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const s3Client = new S3Client({ region });

  let publicIpAddress: string = null;
  let publicDnsName: string = null;

  const bucketPrefix = 'cloudximage-imagestorebucket';

  before(async () => {
    // Get information about instances
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const data = await ec2Client.send(new DescribeInstancesCommand(params));

    // Extract relevant information about the instances
    const deployedInstances = data.Reservations.reduce((acc, reservation) => {
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

    const publicInstance = deployedInstances.find((instance) => instance.type === 'public');

    ({ PublicIpAddress: publicIpAddress, PublicDnsName: publicDnsName } = publicInstance.os);
  });

  it('the application should be deployed in the public subnet and should be accessible by HTTP', async () => {
    // should be accessible via public IP address
    const responsePublicIpAddress = await axios.get(`http://${publicIpAddress}/api/image`);
    expect(responsePublicIpAddress.status, 'Get public IP address response status is not correct').to.equal(200);

    // should be accessible via public DNS Name
    const responsePublicDnsName = await axios.get(`http://${publicDnsName}/api/image`);
    expect(responsePublicDnsName.status, 'Get public DNS Name response status is not correct').to.equal(200);
  });

  it.skip('the application instance should be accessible by SSH protocol', () => {
    const privateKeyPath = join(process.cwd(), 'credentials', 'cloudx.pem');
    const privateKey = readFileSync(privateKeyPath, 'utf8');

    const config = {
      host: publicIpAddress,
      port: 22,
      username: 'ec2-user',
      privateKey,
    };

    const conn = new Client();

    const isConnected = conn
      .on('ready', () => {
        // eslint-disable-next-line no-console
        console.log('SSH connection successful');

        // Execute a command on the remote machine
        conn.exec('uptime', (err, stream) => {
          if (err) throw err;

          // Collect the output of the command
          stream.on('data', (data) => {
            // eslint-disable-next-line no-console
            console.log('Command Output:', data.toString());
            conn.end();
          });
        });
      })
      .on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('Error:', err);
        conn.end();
      })
      .connect(config);

    expect(isConnected, 'The application instance is not accessible by SSH protocol').to.be.true;
  });

  it('the application should have access to the S3 bucket via an IAM role', async () => {
    const listBucketsCommand = new ListBucketsCommand({});
    const listBucketsData = await s3Client.send(listBucketsCommand);
    const bucketName = listBucketsData.Buckets.find((bucket) => bucket.Name.startsWith(bucketPrefix))?.Name;

    if (!bucketName) throw new Error(`No S3 bucket found with prefix: ${bucketPrefix}`);

    try {
      const response = await s3Client.send(new ListObjectsCommand({ Bucket: bucketName }));
      expect(response.Name, 'Bucket name is not correct').to.contains(bucketPrefix);
    } catch (error) {
      expect.fail('Error accessing S3 bucket');
    }
  });

  it('should return S3 bucket data', async () => {
    const listBucketsCommand = new ListBucketsCommand({});
    const listBucketsData = await s3Client.send(listBucketsCommand);
    const bucketName = listBucketsData.Buckets.find((bucket) => bucket.Name.startsWith(bucketPrefix))?.Name;

    if (!bucketName) throw new Error(`No S3 bucket found with prefix: ${bucketPrefix}`);

    // Check bucket tags
    const getBucketTaggingCommand = new GetBucketTaggingCommand({ Bucket: bucketName });
    const { TagSet } = await s3Client.send(getBucketTaggingCommand);
    expect(
      TagSet.some((tag) => tag.Key === 'cloudx'),
      'There is no bucket tag with name "cloudx"',
    ).to.be.true;

    // Check bucket encryption
    const getBucketEncryptionCommand = new GetBucketEncryptionCommand({ Bucket: bucketName });
    const { ServerSideEncryptionConfiguration } = await s3Client.send(getBucketEncryptionCommand);
    expect(
      ServerSideEncryptionConfiguration.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
      'SSE S3 Algorithm is not correct',
    ).to.equal('AES256');

    // Check bucket versioning
    const getBucketVersioningCommand = new GetBucketVersioningCommand({ Bucket: bucketName });
    const { Status } = await s3Client.send(getBucketVersioningCommand);
    expect(Status === undefined || Status === 'Suspended', 'Bucket versioning is not correct').to.be.true;

    // Check bucket public access
    const getPublicAccessBlockCommand = new GetPublicAccessBlockCommand({ Bucket: bucketName });
    const getBucketPolicyStatusCommand = new GetBucketPolicyStatusCommand({ Bucket: bucketName });

    const { PublicAccessBlockConfiguration } = await s3Client.send(getPublicAccessBlockCommand);
    const { PolicyStatus } = await s3Client.send(getBucketPolicyStatusCommand);

    const hasPublicAccess =
      PublicAccessBlockConfiguration.BlockPublicAcls &&
      PublicAccessBlockConfiguration.IgnorePublicAcls &&
      PublicAccessBlockConfiguration.BlockPublicPolicy &&
      PublicAccessBlockConfiguration.RestrictPublicBuckets &&
      PolicyStatus.IsPublic === false;

    expect(hasPublicAccess, 'Bucket has no public access').to.be.true;
  });
});
