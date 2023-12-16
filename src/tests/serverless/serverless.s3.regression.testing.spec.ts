import { expect } from 'chai';
import {
  EC2Client,
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  type DescribeInstancesCommandInput,
} from '@aws-sdk/client-ec2';
import {
  DeleteObjectCommand,
  ListBucketsCommand,
  type ListBucketsCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import AWS from 'aws-sdk';
import axios, { type AxiosResponse } from 'axios';
import _ from 'lodash';
import fs from 'fs-extra';
import FormData from 'form-data';
import { join } from 'path';
import internal from 'stream';
import { log } from '../../utilities/common';
import { BaseConfig } from '../../BaseConfig';

describe('Serverless S3 regression testing', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const s3Client: S3Client = new S3Client(region);

  let ec2IpAddress: string = null;
  let bucketName: string = null;

  const bucketPrefix: string = 'cloudxserverless-imagestorebucket';
  const s3ImagesPath: string = 'images/';

  before(async () => {
    const params: DescribeInstancesCommandInput = {
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
          os: instance,
        })),
      );
    }, []);

    const ec2Instance = deployedInstances.find((instance) => instance.type === 'public');
    ({ PublicIpAddress: ec2IpAddress } = ec2Instance.os);

    if (!ec2IpAddress) throw new Error(`No public EC2 instance found`);

    const listBucketsCommand: ListBucketsCommand = new ListBucketsCommand({});
    const listBucketsData: ListBucketsCommandOutput = await s3Client.send(listBucketsCommand);
    bucketName = listBucketsData.Buckets.find((bucket) => bucket.Name.startsWith(bucketPrefix))?.Name;

    if (!bucketName) throw new Error(`No S3 bucket found with prefix: ${bucketPrefix}`);
  });

  it('should upload images to the S3 bucket (via application API)', async () => {
    const image: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', image);

    const formData: FormData = new FormData();
    formData.append('upfile', fs.createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const response: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(response.status, 'Post image response status is not correct').to.equal(200);
    expect(response.data.id, 'Image ID is not correct').to.be.a('string');
  });

  it('should download images from the S3 bucket', async () => {
    try {
      const folderPath: string = join(process.cwd(), 'downloads');
      await fs.ensureDir(folderPath);
      log(`Folder has been created/verified: ${folderPath}`);
    } catch (error) {
      if (error instanceof Error) log(`Error creating folder: ${error.message}`);
      throw error;
    }

    const destinationPath: string = join(process.cwd(), 'downloads', 'image.jpg');

    const listObjectsCommand: ListObjectsV2Command = new ListObjectsV2Command({ Bucket: bucketName });
    const { Contents } = await s3Client.send(listObjectsCommand);

    if (!Contents.length) throw new Error(`No images uploaded to S3`);

    const imageKey: string = _.sample(Contents.map(({ Key }) => Key));

    const s3: AWS.S3 = new AWS.S3({ region });

    try {
      const getObjectCommandResponse: internal.Readable = s3
        .getObject({ Bucket: bucketName, Key: imageKey })
        .createReadStream();

      const fileStream: fs.WriteStream = fs.createWriteStream(destinationPath);
      getObjectCommandResponse.pipe(fileStream);

      await new Promise((resolve, reject) => {
        fileStream.on('finish', () => {
          log(`Image downloaded successfully: ${destinationPath}`);
          resolve(true);
        });

        fileStream.on('error', (error) => {
          log(`Error writing image: ${error}`);
          reject(error);
        });
      });
    } catch (error) {
      if (error instanceof Error) log(error.message);
      expect.fail('Unexpected error while downloading image:', error);
    }

    // Check if the downloaded image file exists
    expect(fs.existsSync(destinationPath), 'Image should be downloaded successfully').to.be.true;

    // Delete the downloaded image file after the test
    fs.unlinkSync(destinationPath);
  });

  it('should view a list of uploaded images', async () => {
    const listObjectsCommand: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: s3ImagesPath,
    });
    const listObjectsCommandResponse: ListObjectsV2CommandOutput = await s3Client.send(listObjectsCommand);
    const imagesListFromS3: string[] = listObjectsCommandResponse.Contents.map((item) => item.Key);

    expect(imagesListFromS3.length, 'Images list returned from S3 is not correct').to.be.greaterThan(0);

    const response: AxiosResponse = await axios.get(`http://${ec2IpAddress}/api/image`);
    expect(response.status, 'Get images response status is not correct').to.equal(200);
    const imagesListFromApi: string[] = response.data.map((image) => image.object_key);

    expect(imagesListFromApi.length, 'Images list returned from API is not correct').to.be.greaterThan(0);
  });

  it('should delete an image from the S3 bucket', async () => {
    const listObjectsCommand: ListObjectsV2Command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: s3ImagesPath,
    });
    const listObjectsCommandBeforeDeletionResponse: ListObjectsV2CommandOutput =
      await s3Client.send(listObjectsCommand);
    const imageListBeforeDeletion: string[] = listObjectsCommandBeforeDeletionResponse.Contents.map((item) => item.Key);

    expect(imageListBeforeDeletion.length, 'Images list returned from S3 is not correct').to.be.greaterThan(0);

    const imageKeyToDelete: string = _.sample(imageListBeforeDeletion);

    const deleteObjectCommand: DeleteObjectCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: imageKeyToDelete,
    });
    await s3Client.send(deleteObjectCommand);

    const listObjectsCommandAfterDeletionResponse: ListObjectsV2CommandOutput = await s3Client.send(listObjectsCommand);
    const imageListAfterDeletion: string[] = listObjectsCommandAfterDeletionResponse.Contents.map((item) => item.Key);

    expect(imageListAfterDeletion, 'Deleted image should not be in the list after deletion').not.includes(
      imageKeyToDelete,
    );
  });
});
