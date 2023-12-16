import { expect } from 'chai';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  EC2Client,
  type DescribeInstancesCommandInput,
} from '@aws-sdk/client-ec2';
import axios, { type AxiosResponse } from 'axios';
import _ from 'lodash';
import fs from 'fs-extra';
import { join } from 'path';
import FormData from 'form-data';
import {
  type AttributeValue,
  DynamoDBClient,
  ListTablesCommand,
  type ListTablesCommandOutput,
  ScanCommand,
  type ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { BaseConfig } from '../../BaseConfig';

describe('Serverless DynamoDB regression testing', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const dynamoDBClient = new DynamoDBClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const dynamoDBTablePrefix = 'cloudxserverless-DatabaseImagesTable';

  let ec2IpAddress: string = null;
  let dynamoDBTableName: string = null;
  let randomImageId: string = null;

  before(async function () {
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
          instanceType: instance.InstanceType,
          tags: instance.Tags,
          rootBlockDeviceSize: instance.BlockDeviceMappings[0]?.Ebs,
          os: instance,
        })),
      );
    }, []);

    const ec2Instance: any = deployedInstances.find((instance) => instance.type === 'public');
    ({ PublicIpAddress: ec2IpAddress } = ec2Instance.os);

    if (!ec2Instance) throw new Error(`No public EC2 instance found`);

    const listTablesResp: ListTablesCommandOutput = await dynamoDBClient.send(new ListTablesCommand({}));

    dynamoDBTableName = listTablesResp.TableNames.find((table) => table.includes(dynamoDBTablePrefix));

    if (!dynamoDBTableName) throw new Error('There is no DynamoDB table');
  });

  it('the uploaded image metadata should be stored in DynamoDB table', async () => {
    const randomImage: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', randomImage);

    const formData: FormData = new FormData();
    formData.append('upfile', fs.createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const response: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(response.status, 'Post image response status is not correct').to.equal(200);
    expect(response.data.id, 'Image ID is not correct').to.be.a('string');

    const createdImageId = response.data.id;

    const scanResp: ScanCommandOutput = await dynamoDBClient.send(new ScanCommand({ TableName: dynamoDBTableName }));
    const imageIds: string[] = scanResp.Items.map((image: Record<string, AttributeValue>) => image.id.S);

    expect(imageIds, 'There is no created image in the database').to.includes(createdImageId);

    randomImageId = _.sample(imageIds);
  });

  it('the image metadata should be returned by {base URL}/image/{image_id} GET request', async () => {
    const response: AxiosResponse = await axios.get(`http://${ec2IpAddress}/api/image/${randomImageId}`);
    expect(response.status, 'Get image by ID response status is not correct').to.equal(200);

    expect(response.data.id, 'id in response is not correct').to.be.a('string');
    expect(response.data.object_key, 'object_key in response is not correct').to.be.a('string');
    expect(response.data.object_type, 'object_type in response is not correct').to.be.a('string');
    expect(response.data.object_size, 'object_size in response is not correct').to.be.a('number');
    expect(response.data.created_at, 'created_at in response is not correct').to.be.a('number');
    expect(response.data.last_modified, 'last_modified in response is not correct').to.be.a('number');
  });

  it('the image metadata for the deleted image should be deleted from the database', async () => {
    const deleteImageResp: AxiosResponse = await axios.delete(`http://${ec2IpAddress}/api/image/${randomImageId}`);
    expect(deleteImageResp.status, 'Delete image by ID response status is not correct').to.equal(200);

    const getImagesResp: AxiosResponse = await axios.get(`http://${ec2IpAddress}/api/image`);
    expect(getImagesResp.status, 'Get images response status is not correct').to.equal(200);

    const imagesLengthFromAPI: number = getImagesResp.data.length;

    const scanResp: ScanCommandOutput = await dynamoDBClient.send(new ScanCommand({ TableName: dynamoDBTableName }));
    const imageIds = scanResp.Items.map((image: Record<string, AttributeValue>) => image.id.S);

    const imagesLengthFromDB: number = scanResp.Items.length;

    expect(imagesLengthFromAPI, 'The number of images in the API and DB is different').to.equal(imagesLengthFromDB);
    expect(
      imageIds,
      `The image ID still exists in the table "${dynamoDBTableName}" after being deleted`,
    ).not.to.include(randomImageId);
  });
});
