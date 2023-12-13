import {
  SNSClient,
  SubscribeCommand,
  UnsubscribeCommand,
  ListSubscriptionsCommand,
  GetSubscriptionAttributesCommand,
  ListTopicsCommand,
  type ListTopicsCommandOutput,
  type SubscribeCommandOutput,
  ListSubscriptionsByTopicCommand,
  type Subscription,
  type ListSubscriptionsByTopicCommandOutput,
  type ListSubscriptionsCommandOutput,
  type SubscribeCommandInput,
  ConfirmSubscriptionCommand,
  PublishCommand,
  type PublishCommandInput,
  type PublishCommandOutput,
  GetTopicAttributesCommand,
  type GetTopicAttributesCommandOutput,
  ListTagsForResourceCommand,
  type ListTagsForResourceCommandOutput,
  type ConfirmSubscriptionCommandOutput,
} from '@aws-sdk/client-sns';
import {
  GetQueueAttributesCommand,
  type GetQueueAttributesCommandOutput,
  ListQueuesCommand,
  type ListQueuesCommandOutput,
  SQSClient,
  type SendMessageCommandInput,
  SendMessageCommand,
  type SendMessageCommandOutput,
  ListQueueTagsCommand,
  type ListQueueTagsCommandOutput,
} from '@aws-sdk/client-sqs';
import { DescribeInstancesCommand, type DescribeInstancesCommandOutput, EC2Client } from '@aws-sdk/client-ec2';
import { GetInstanceProfileCommand, type GetInstanceProfileCommandOutput, IAMClient } from '@aws-sdk/client-iam';
import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import { type AxiosResponse } from 'axios';
import { BaseConfig } from '../../BaseConfig';
import { generateMailtrapEmail } from '../../utilities/common';
import { MailtrapApiClient } from '../../utilities/api/MailtrapApiClient';

describe('SNS/SQS deployment validation', function () {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const snsClient: SNSClient = new SNSClient({
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

  const ec2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const iamClient = new IAMClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const topicSnsPrefix = 'cloudximage-TopicSNSTopic';
  const queueSqsPrefix = 'cloudximage-QueueSQSQueue';

  let topicSns: string = null;
  let queueSqsUrl: string = null;

  before(async () => {
    const listTopicsResp: ListTopicsCommandOutput = await snsClient.send(new ListTopicsCommand({}));

    ({ TopicArn: topicSns } = listTopicsResp.Topics.find((topic) => topic.TopicArn.includes(topicSnsPrefix)));

    if (!topicSns) throw new Error('There is no Topics ARN for the SNS');

    const listQueuesResp: ListQueuesCommandOutput = await sqsClient.send(new ListQueuesCommand({}));

    queueSqsUrl = listQueuesResp.QueueUrls.find((queue) => queue.includes(queueSqsPrefix));

    if (!queueSqsUrl) throw new Error('There is no Queue URL for the SQS');
  });

  it('should subscribe and unsubscribe a user', async () => {
    const endpoint: string = generateMailtrapEmail();

    const subscribeParams: SubscribeCommandInput = {
      Protocol: 'email',
      TopicArn: topicSns,
      Endpoint: endpoint,
    };

    // Subscribe
    const subscribeResp: SubscribeCommandOutput = await snsClient.send(new SubscribeCommand(subscribeParams));
    expect(subscribeResp.SubscriptionArn, 'SubscriptionArn is not correct').to.be.a('string');

    // Get email
    const subject = 'AWS Notification - Subscription Confirmation';
    const mailtrapService: MailtrapApiClient = new MailtrapApiClient();
    const subscriptionResp: AxiosResponse<string, any> = await mailtrapService.getLatestMessageHTMLBySubject(
      endpoint,
      subject,
    );

    // Extract URL
    const urlRegex: RegExp = /(https:\/\/sns\.us-east-1\.amazonaws\.com[^"]*)/;
    const [, url] = subscriptionResp.data.match(urlRegex);

    // Extract token
    const tokenRegex: RegExp = /Token=([^&]*)/;
    const [, token] = url.match(tokenRegex);

    // Confirm subscription
    const confirmSubscriptionResp: ConfirmSubscriptionCommandOutput = await snsClient.send(
      new ConfirmSubscriptionCommand({
        TopicArn: topicSns,
        Token: token,
      }),
    );

    const { SubscriptionArn } = confirmSubscriptionResp;

    // Get subscription
    const listSubscriptionsResp: ListSubscriptionsByTopicCommandOutput = await snsClient.send(
      new ListSubscriptionsByTopicCommand({
        TopicArn: topicSns,
      }),
    );

    const subscription: Subscription = listSubscriptionsResp.Subscriptions.find(
      ({ Endpoint }) => Endpoint === endpoint,
    );

    expect(subscription.SubscriptionArn, 'SubscriptionArn is not correct').to.includes('cloudximage-TopicSNSTopic');
    expect(subscription.Protocol, 'Protocol is not correct').to.equal('email');
    expect(subscription.Endpoint, 'Endpoint is not correct').to.equal(endpoint);
    expect(subscription.TopicArn, 'TopicArn is not correct').to.equal(topicSns);

    // Unsubscribe
    await snsClient.send(new UnsubscribeCommand({ SubscriptionArn }));

    // Check if it's unsubscribed
    try {
      await snsClient.send(new GetSubscriptionAttributesCommand({ SubscriptionArn }));
      expect.fail('Subscription still exists.');
    } catch (error) {
      expect(JSON.stringify(error)).to.contain('Subscription does not exist');
    }
  });

  it('should return a list of all subscriptions', async () => {
    const endpoint = `test+${randomUUID()}@example.com`;

    const params: SubscribeCommandInput = {
      Protocol: 'email',
      TopicArn: topicSns,
      Endpoint: endpoint,
    };

    const subscribeResp: SubscribeCommandOutput = await snsClient.send(new SubscribeCommand(params));
    expect(subscribeResp.SubscriptionArn, 'SubscriptionArn is not correct').to.be.a('string');

    const listSubscriptionsResp: ListSubscriptionsCommandOutput = await snsClient.send(
      new ListSubscriptionsCommand({}),
    );
    expect(listSubscriptionsResp.Subscriptions, 'Subscriptions is not an array').to.be.an('array');
    expect(
      listSubscriptionsResp.Subscriptions.map((subscription) => subscription.Endpoint),
      `There is no required email ${endpoint} in the List Subscriptions response`,
    ).to.include(endpoint);
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

  it('should be able to publish a message to an SNS topic', async () => {
    const params: PublishCommandInput = {
      TopicArn: topicSns,
      Message: 'Test Message',
    };

    const data: PublishCommandOutput = await snsClient.send(new PublishCommand(params));
    expect(data, 'There is no MessageId property in Publish response').to.have.property('MessageId');
  });

  it('should have IAM roles assigned', async () => {
    const describeInstancesResp: DescribeInstancesCommandOutput = await ec2Client.send(
      new DescribeInstancesCommand({}),
    );

    const instanceId: string = describeInstancesResp?.Reservations?.[0]?.Instances?.[0]?.InstanceId;

    const instanceResp: DescribeInstancesCommandOutput = await ec2Client.send(
      new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
    );

    const instanceProfileArn: string = instanceResp.Reservations?.[0].Instances?.[0].IamInstanceProfile?.Arn;
    const [, instanceProfileName] = instanceProfileArn.split('/');

    const instanceProfileData: GetInstanceProfileCommandOutput = await iamClient.send(
      new GetInstanceProfileCommand({ InstanceProfileName: instanceProfileName }),
    );

    const roles: string[] = instanceProfileData.InstanceProfile.Roles.map((role) => role.RoleName);
    expect(roles).to.be.an('array', 'The instance should have at least one role').that.is.not.empty;
  });

  it('should match SNS queue requirements', async () => {
    const attrsResp: GetTopicAttributesCommandOutput = await snsClient.send(
      new GetTopicAttributesCommand({
        TopicArn: topicSns,
      }),
    );

    expect(attrsResp.Attributes.KmsMasterKeyId, 'Encryption is enabled').to.be.undefined;

    const tagsResp: ListTagsForResourceCommandOutput = await snsClient.send(
      new ListTagsForResourceCommand({
        ResourceArn: topicSns,
      }),
    );

    expect(tagsResp.Tags.find((tag) => tag.Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal('qa');
  });

  it('should match SQS queue requirements', async () => {
    const attrsResp: GetQueueAttributesCommandOutput = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueSqsUrl,
        AttributeNames: ['All'],
      }),
    );

    expect(attrsResp.Attributes.SqsManagedSseEnabled, 'Encryption is disabled').to.equal('true');

    const tagsResp: ListQueueTagsCommandOutput = await sqsClient.send(
      new ListQueueTagsCommand({
        QueueUrl: queueSqsUrl,
      }),
    );

    expect(tagsResp.Tags.cloudx, `Tag 'cloudx' is not correct`).to.equal('qa');
  });
});
