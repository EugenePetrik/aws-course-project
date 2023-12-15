import {
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  type ListTablesCommandOutput,
  type DescribeTableCommandOutput,
  ListTagsOfResourceCommand,
  DescribeTimeToLiveCommand,
  ScanCommand,
  type DescribeTimeToLiveCommandOutput,
  type ListTagsOfResourceCommandOutput,
  type ScanCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { expect } from 'chai';
import {
  ListQueuesCommand,
  type ListQueuesCommandOutput,
  SQSClient,
  SendMessageCommand,
  type SendMessageCommandInput,
  type SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import {
  ListTopicsCommand,
  type ListTopicsCommandOutput,
  SNSClient,
  type SubscribeCommandInput,
  SubscribeCommandOutput,
  SubscribeCommand,
  ConfirmSubscriptionCommand,
  type ListSubscriptionsByTopicCommandOutput,
  ListSubscriptionsByTopicCommand,
  type Subscription,
  type ListSubscriptionsCommandOutput,
  ListSubscriptionsCommand,
} from '@aws-sdk/client-sns';
import {
  type EventSourceMappingConfiguration,
  type FunctionConfiguration,
  GetFunctionConfigurationCommand,
  type GetFunctionConfigurationCommandOutput,
  LambdaClient,
  ListEventSourceMappingsCommand,
  ListFunctionsCommand,
  type ListFunctionsCommandOutput,
  ListTagsCommand,
  type ListTagsCommandOutput,
} from '@aws-sdk/client-lambda';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandInput,
  type DescribeInstancesCommandOutput,
  EC2Client,
} from '@aws-sdk/client-ec2';
import _ from 'lodash';
import { createReadStream } from 'fs-extra';
import FormData from 'form-data';
import axios, { type AxiosResponse } from 'axios';
import { join } from 'path';
import { IAMClient, ListRolesCommand, ListRolesCommandOutput, Role } from '@aws-sdk/client-iam';
import { BaseConfig } from '../../BaseConfig';
import { generateMailtrapEmail } from '../../utilities/common';
import { MailtrapApiClient } from '../../utilities/api/MailtrapApiClient';

describe('Serverless application functional validation', function () {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const iamClient: IAMClient = new IAMClient({
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

  const sqsClient: SQSClient = new SQSClient({
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

  const lambdaClient = new LambdaClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const mailtrapEmailEndpoint: string = generateMailtrapEmail();

  const dynamoDBTablePrefix = 'cloudxserverless-DatabaseImagesTable';
  const topicSnsPrefix = 'cloudxserverless-TopicSNSTopic';
  const queueSqsPrefix = 'cloudxserverless-QueueSQSQueue';
  const lambdaFunctionPrefix = 'cloudxserverless-EventHandlerLambda';

  let ec2IpAddress: string = null;
  let dynamoDBTableName: string = null;
  let topicSns: string = null;
  let queueSqsUrl: string = null;
  let lambdaFunctionName: string = null;

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

    const listTablesResp: ListTablesCommandOutput = await dynamoDBClient.send(new ListTablesCommand({}));

    dynamoDBTableName = listTablesResp.TableNames.find((table) => table.includes(dynamoDBTablePrefix));

    if (!dynamoDBTableName) throw new Error('There is no DynamoDB table');

    const listTopicsResp: ListTopicsCommandOutput = await snsClient.send(new ListTopicsCommand({}));

    ({ TopicArn: topicSns } = listTopicsResp.Topics.find((topic) => topic.TopicArn.includes(topicSnsPrefix)));

    if (!topicSns) throw new Error('There is no Topics ARN for the SNS');

    const listQueuesResp: ListQueuesCommandOutput = await sqsClient.send(new ListQueuesCommand({}));

    queueSqsUrl = listQueuesResp.QueueUrls.find((queue) => queue.includes(queueSqsPrefix));

    if (!queueSqsUrl) throw new Error('There is no Queue URL for the SQS');

    const listFunctionsResp: ListFunctionsCommandOutput = await lambdaClient.send(new ListFunctionsCommand({}));

    lambdaFunctionName = listFunctionsResp.Functions.find((lambda: FunctionConfiguration) => {
      return lambda.FunctionName.includes(lambdaFunctionPrefix);
    }).FunctionName;

    if (!lambdaFunctionName) throw new Error('There is no Lambda function');
  });

  it('the application database should be replaced with a DynamoDB table', async () => {
    const describeTableResp: DescribeTableCommandOutput = await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: dynamoDBTableName }),
    );
    expect(describeTableResp.Table.TableArn, `Table TableArn is not correct`).to.includes(dynamoDBTablePrefix);
    expect(describeTableResp.Table.TableId, `Table TableId is not correct`).to.exist.and.not.be.empty;
    expect(describeTableResp.Table.TableName, `Table TableName is not correct`).to.includes(dynamoDBTablePrefix);
    expect(describeTableResp.Table.TableStatus, `Table TableStatus is not correct`).to.equal('ACTIVE');
  });

  it('the DynamoDB table should store the image metadata information', async () => {
    const randomImage: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', randomImage);

    const formData: FormData = new FormData();
    formData.append('upfile', createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const response: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(response.status, 'Post image response status is not correct').to.equal(200);
    expect(response.data.id, 'Image ID is not correct').to.be.a('string');

    const scanResp: ScanCommandOutput = await dynamoDBClient.send(
      new ScanCommand({
        TableName: dynamoDBTableName,
        Limit: 1,
      }),
    );

    expect(Object.keys(scanResp.Items[0]), 'The image metadata information is not correct').to.eql([
      'object_key',
      'object_size',
      'created_at',
      'object_type',
      'id',
      'last_modified',
    ]);
  });

  it('should subscribe a user', async () => {
    const subscribeParams: SubscribeCommandInput = {
      Protocol: 'email',
      TopicArn: topicSns,
      Endpoint: mailtrapEmailEndpoint,
    };

    // Subscribe
    const subscribeResp: SubscribeCommandOutput = await snsClient.send(new SubscribeCommand(subscribeParams));
    expect(subscribeResp.SubscriptionArn, 'SubscriptionArn is not correct').to.be.a('string');

    // Get email
    const subject = 'AWS Notification - Subscription Confirmation';
    const mailtrapService: MailtrapApiClient = new MailtrapApiClient();
    const subscriptionResp: AxiosResponse<string, any> = await mailtrapService.getLatestMessageHTMLBySubject(
      mailtrapEmailEndpoint,
      subject,
    );

    // Extract URL
    const urlRegex: RegExp = /(https:\/\/sns\.us-east-1\.amazonaws\.com[^"]*)/;
    const [, url] = subscriptionResp.data.match(urlRegex);

    // Extract token
    const tokenRegex: RegExp = /Token=([^&]*)/;
    const [, token] = url.match(tokenRegex);

    // Confirm subscription
    await snsClient.send(
      new ConfirmSubscriptionCommand({
        TopicArn: topicSns,
        Token: token,
      }),
    );

    // Get subscription
    const listSubscriptionsResp: ListSubscriptionsByTopicCommandOutput = await snsClient.send(
      new ListSubscriptionsByTopicCommand({
        TopicArn: topicSns,
      }),
    );

    const subscription: Subscription = listSubscriptionsResp.Subscriptions.find(
      ({ Endpoint }) => Endpoint === mailtrapEmailEndpoint,
    );

    expect(subscription.SubscriptionArn, 'SubscriptionArn is not correct').to.includes(
      'cloudxserverless-TopicSNSTopic',
    );
    expect(subscription.Protocol, 'Protocol is not correct').to.equal('email');
    expect(subscription.Endpoint, 'Endpoint is not correct').to.equal(mailtrapEmailEndpoint);
    expect(subscription.TopicArn, 'TopicArn is not correct').to.equal(topicSns);
  });

  it('the subscribed user receives notifications about images events', async () => {
    const randomImage: string = _.sample(['beach.jpg', 'coffee.jpg', 'tree.jpeg']);
    const filePath: string = join(process.cwd(), 'src', 'testData', randomImage);

    const formData: FormData = new FormData();
    formData.append('upfile', createReadStream(filePath));

    const headers: { [key: string]: string } = {
      'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
      ...formData.getHeaders(),
    };

    const response: AxiosResponse = await axios.post(`http://${ec2IpAddress}/api/image`, formData, { headers });
    expect(response.status, 'Post image response status is not correct').to.equal(200);
    expect(response.data.id, 'Image ID is not correct').to.be.a('string');

    // Get email
    const subject = 'AWS Notification Message';
    const mailtrapService: MailtrapApiClient = new MailtrapApiClient();
    const notificationResp: AxiosResponse<string, any> = await mailtrapService.getLatestMessageTextBySubject(
      mailtrapEmailEndpoint,
      subject,
    );
    const emailText: string = notificationResp.data;

    expect(emailText, 'Email should include image upload event_type').to.includes('event_type: upload');
    expect(emailText, 'Email should include image upload object_key').to.includes('object_key: images/');
    expect(emailText, 'Email should include image upload object_type').to.includes('object_type: binary/octet-stream');
    expect(emailText, 'Email should include image upload last_modified').to.includes('last_modified: ');
    expect(emailText, 'Email should include image upload object_size').to.includes('object_size: ');
    expect(emailText, 'Email should include image upload download_link').to.includes('download_link: http://ec2');
  });

  it('should return a list of all subscriptions', async () => {
    const listSubscriptionsResp: ListSubscriptionsCommandOutput = await snsClient.send(
      new ListSubscriptionsCommand({}),
    );
    expect(listSubscriptionsResp.Subscriptions, 'Subscriptions is not an array').to.be.an('array');
    expect(listSubscriptionsResp.Subscriptions, 'There are no subscriptions').to.be.greaterThan(0);
  });

  it('should be able to send a message to an SQS queue', async () => {
    const params: SendMessageCommandInput = {
      QueueUrl: queueSqsUrl,
      MessageBody: 'Event message',
    };

    const data: SendMessageCommandOutput = await sqsClient.send(new SendMessageCommand(params));
    expect(data, 'There is no MD5OfMessageBody property in Send Message response').to.have.property('MD5OfMessageBody');
    expect(data, 'There is no MessageId property in Send Message response').to.have.property('MessageId');
  });

  it('lambda function should be subscribed to the SQS queue to filter and put event messages to the SNS topic', async () => {
    const listEventSourceMappingsResp = await lambdaClient.send(
      new ListEventSourceMappingsCommand({
        FunctionName: lambdaFunctionName,
      }),
    );

    const sqsQueueLambda: EventSourceMappingConfiguration = listEventSourceMappingsResp.EventSourceMappings.find(
      (mapping: EventSourceMappingConfiguration) => {
        return mapping.FunctionArn.includes(lambdaFunctionPrefix);
      },
    );

    expect(sqsQueueLambda.EventSourceArn, `EventSourceMappings.EventSourceArn is not correct`).to.includes(
      'cloudxserverless-QueueSQSQueue',
    );
    expect(sqsQueueLambda.State, `EventSourceMappings.State is not correct`).to.equal('Enabled');
    expect(sqsQueueLambda.StateTransitionReason, `EventSourceMappings.StateTransitionReason is not correct`).to.equal(
      'USER_INITIATED',
    );
    expect(sqsQueueLambda.UUID, `EventSourceMappings.UUID is not correct`).to.exist.and.not.be.empty;
  });

  it('the application should have access to the S3 bucket, the DynamoDB table, the SQS queue and the SNS topic instance via IAM roles', async () => {
    const listRolesResp: ListRolesCommandOutput = await iamClient.send(new ListRolesCommand({}));

    const roles: string[] = listRolesResp.Roles.map((role: Role) => role.RoleName);

    const isRoleExist = (roleName: string) => roles.some((role) => role.includes(roleName));

    expect(isRoleExist('AWSServiceRoleForApplicationAutoScaling_DynamoDBTable')).to.be.true;
    expect(isRoleExist('AWSServiceRoleForRDS')).to.be.true;
    expect(isRoleExist('cloudxserverless-AppInstanceInstanceRole')).to.be.true;
    expect(isRoleExist('cloudxserverless-CustomCDKBucketDeployment')).to.be.true;
    expect(isRoleExist('cloudxserverless-CustomS3AutoDeleteObjectsCustom')).to.be.true;
    expect(isRoleExist('cloudxserverless-EventHandlerLambdaRole')).to.be.true;
    expect(isRoleExist('cloudxserverless-LogRetention')).to.be.true;
  });

  it('should return Lambda configuration', async () => {
    const getFunctionConfigurationData: GetFunctionConfigurationCommandOutput = await lambdaClient.send(
      new GetFunctionConfigurationCommand({
        FunctionName: lambdaFunctionName,
      }),
    );

    expect(getFunctionConfigurationData.MemorySize, `Lambda MemorySize is not correct`).to.equal(128);
    expect(getFunctionConfigurationData.Timeout, `Lambda Timeout is not correct`).to.equal(3);
    expect(getFunctionConfigurationData.EphemeralStorage.Size, `Lambda Size is not correct`).to.equal(512);
    expect(getFunctionConfigurationData.Environment.Variables.TOPIC_ARN, `Lambda TOPIC_ARN is not correct`).to.includes(
      'cloudxserverless-TopicSNSTopic',
    );
    expect(getFunctionConfigurationData.LoggingConfig.LogFormat, `Lambda LogFormat is not correct`).to.equal('Text');
    expect(getFunctionConfigurationData.LoggingConfig.LogGroup, `Lambda LogGroup is not correct`).to.includes(
      '/aws/lambda/cloudxserverless-EventHandlerLambda',
    );

    const lambdaFunctionArn: string = getFunctionConfigurationData.FunctionArn;

    const listTagsResp: ListTagsCommandOutput = await lambdaClient.send(
      new ListTagsCommand({
        Resource: lambdaFunctionArn,
      }),
    );

    expect(listTagsResp?.Tags?.cloudx, `Lambda Tags are not correct`).to.equal('qa');
  });

  it('should return DynamoDB table', async () => {
    const describeTableResp: DescribeTableCommandOutput = await dynamoDBClient.send(
      new DescribeTableCommand({ TableName: dynamoDBTableName }),
    );

    expect(
      describeTableResp.Table.ProvisionedThroughput.ReadCapacityUnits,
      `DynamoDB Table.ProvisionedThroughput.ReadCapacityUnits is not correct`,
    ).to.eql(5);
    expect(
      describeTableResp.Table.ProvisionedThroughput.WriteCapacityUnits,
      `DynamoDB Table.ProvisionedThroughput.WriteCapacityUnits is not correct`,
    ).to.eql(1);
    expect(
      describeTableResp?.Table?.GlobalSecondaryIndexes,
      `DynamoDB Table.GlobalSecondaryIndexes is not correct`,
    ).to.eql(undefined);

    const describeTimeToLiveResp: DescribeTimeToLiveCommandOutput = await dynamoDBClient.send(
      new DescribeTimeToLiveCommand({ TableName: dynamoDBTableName }),
    );

    expect(
      describeTimeToLiveResp.TimeToLiveDescription.TimeToLiveStatus,
      `DynamoDB TimeToLiveDescription.TimeToLiveStatus is not correct`,
    ).to.eql('DISABLED');

    const resourceArn: string = describeTableResp.Table.TableArn;

    const listTagsOfResourceResp: ListTagsOfResourceCommandOutput = await dynamoDBClient.send(
      new ListTagsOfResourceCommand({ ResourceArn: resourceArn }),
    );

    expect(
      listTagsOfResourceResp.Tags.find((tag) => tag.Key === 'cloudx').Value,
      `DynamoDB Tags are not correct`,
    ).to.equal('qa');
  });
});
