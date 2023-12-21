import {
  DescribeLogGroupsCommand,
  type DescribeLogGroupsCommandInput,
  type DescribeLogGroupsCommandOutput,
  type LogGroup,
  FilterLogEventsCommand,
  type FilteredLogEvent,
  CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandInput,
  type DescribeInstancesCommandOutput,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  ListTopicsCommand,
  type ListTopicsCommandOutput,
  SNSClient,
  SubscribeCommand,
  type SubscribeCommandInput,
  type SubscribeCommandOutput,
} from '@aws-sdk/client-sns';
import { expect } from 'chai';
import axios, { type AxiosResponse } from 'axios';
import _ from 'lodash';
import fs from 'fs-extra';
import { join } from 'path';
import FormData from 'form-data';
import { randomUUID } from 'node:crypto';
import { BaseConfig } from '../../BaseConfig';
import { wait } from '../../utilities/common';

describe('Monitoring and logging application validation', function () {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const cloudWatchLogsClient: CloudWatchLogsClient = new CloudWatchLogsClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const snsClient: SNSClient = new SNSClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  let ec2IpAddress: string = null;
  let topicSns: string = null;

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

    const ec2Instance: any = deployedInstances.find((instance) => instance.type === 'public');

    if (!ec2Instance) throw new Error(`No public EC2 instance found`);

    ({ PublicIpAddress: ec2IpAddress } = ec2Instance.os);

    const listTopicsResp: ListTopicsCommandOutput = await snsClient.send(new ListTopicsCommand({}));

    ({ TopicArn: topicSns } = listTopicsResp.Topics.find((topic) => {
      return topic.TopicArn.includes('cloudxserverless-TopicSNSTopic');
    }));

    if (!topicSns) throw new Error('There is no Topics ARN for the SNS');
  });

  it('checks if logs include required image information for each notification', async function () {
    // Add subscription
    const endpoint = `test+${randomUUID()}@example.com`;

    const params: SubscribeCommandInput = {
      Protocol: 'email',
      TopicArn: topicSns,
      Endpoint: endpoint,
    };

    const subscribeResp: SubscribeCommandOutput = await snsClient.send(new SubscribeCommand(params));
    expect(subscribeResp.SubscriptionArn, 'SubscriptionArn is not correct').to.be.a('string');

    // Send API request to create an image
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

    // Wait for event logs
    await wait(30_000);

    // Get the latest created Log Group
    const logGroup: LogGroup = await getLatestLogGroup('/aws/lambda/cloudxserverless-EventHandlerLambda');

    // Get all Log Events
    const logEvents: FilteredLogEvent[] = await fetchLogEvents(logGroup.logGroupName);

    const logEventsMessages: string[] = logEvents.map(({ message }) => message);

    expect(
      logEventsMessages.some((message) => message.includes('object_key')),
      'There is no the image information "object_key" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('object_type')),
      'There is no the image information "object_type" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('last_modified')),
      'There is no the image information "last_modified" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('object_size')),
      'There is no the image information "object_size" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('download_link')),
      'There is no the image information "download_link" in logs',
    ).to.be.true;
  });

  it('checks if logs include HTTP API requests information', async function () {
    // Send API request to create an image
    const randomImage: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', randomImage);

    const formData: FormData = new FormData();
    formData.append('upfile', fs.createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const createResp: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(createResp.status, 'Post image response status is not correct').to.equal(200);
    expect(createResp.data.id, 'Image ID is not correct').to.be.a('string');

    // Send API request to get all images
    const getResp: AxiosResponse = await axios.get(`http://${ec2IpAddress}/api/image`);
    expect(getResp.status, 'Get images response status is not correct').to.equal(200);

    const imageIds: string[] = getResp.data.map((image) => image.id);
    const randomImageId: string = _.sample(imageIds);

    // Send API request to delete an image
    const deleteResp: AxiosResponse = await axios.delete(`http://${ec2IpAddress}/api/image/${randomImageId}`);
    expect(deleteResp.status, 'Delete image by ID response status is not correct').to.equal(200);

    // Wait for event logs
    await wait(30_000);

    // Get the latest created Log Group
    const logGroup: LogGroup = await getLatestLogGroup('/var/log/cloudxserverless-app');

    // Get all Log Events
    const logEvents: FilteredLogEvent[] = await fetchLogEvents(logGroup.logGroupName);

    const logEventsMessages: string[] = logEvents.map(({ message }) => message);

    expect(
      logEventsMessages.some((message) => message.includes('POST /api/image HTTP/1.1')),
      'There is no the image information "POST /api/image HTTP/1.1" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('GET /api/image HTTP/1.1')),
      'There is no the image information "GET /api/image HTTP/1.1" in logs',
    ).to.be.true;
    expect(
      logEventsMessages.some((message) => message.includes('DELETE /api/image')),
      'There is no the image information "DELETE /api/image" in logs',
    ).to.be.true;
  });

  async function getLatestLogGroup(logGroupNamePrefix: string): Promise<LogGroup> {
    const params: DescribeLogGroupsCommandInput = {};
    let logGroups: LogGroup[] = [];
    let logGroupsData: DescribeLogGroupsCommandOutput = null;

    do {
      logGroupsData = await cloudWatchLogsClient.send(new DescribeLogGroupsCommand(params));
      logGroups = [...logGroups, ...logGroupsData.logGroups];
      params.nextToken = logGroupsData.nextToken;
    } while (logGroupsData.nextToken);

    // Sort log groups in descending order by creationTime
    const logGroup: LogGroup[] = logGroups
      .filter((group: LogGroup) => group.logGroupName.includes(logGroupNamePrefix))
      .sort((a: LogGroup, b: LogGroup) => b.creationTime - a.creationTime);

    // Get the latest created log group
    return logGroup[0];
  }

  async function fetchLogEvents(logGroupName: string): Promise<Array<FilteredLogEvent>> {
    let logEvents: FilteredLogEvent[] = [];
    let nextToken: string;

    // Get the date/time from 30 seconds ago and convert it to milliseconds; subtract from current time
    const thirtySecondsAgo = Date.now() - 1000 * 30;

    do {
      const logEventsData = await cloudWatchLogsClient.send(
        new FilterLogEventsCommand({
          logGroupName,
          nextToken,
          startTime: thirtySecondsAgo,
        }),
      );

      logEvents = [...logEvents, ...logEventsData.events];
      nextToken = logEventsData.nextToken;
    } while (nextToken);

    return logEvents;
  }
});
