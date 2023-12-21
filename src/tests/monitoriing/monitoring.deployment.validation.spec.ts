import { CloudWatchClient, ListMetricsCommand, type ListMetricsCommandOutput } from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  type DescribeLogGroupsCommandInput,
  type DescribeLogGroupsCommandOutput,
  DescribeLogStreamsCommand,
  type DescribeLogStreamsCommandOutput,
  type LogGroup,
  type LogStream,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  DescribeInstancesCommand,
  type DescribeInstancesCommandInput,
  type DescribeInstancesCommandOutput,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  CloudTrailClient,
  DescribeTrailsCommand,
  type DescribeTrailsCommandOutput,
  GetTrailCommand,
  GetTrailStatusCommand,
  type GetTrailStatusCommandOutput,
  ListTagsCommand,
  type Trail,
  type GetTrailCommandOutput,
  type ListTagsCommandOutput,
} from '@aws-sdk/client-cloudtrail';
import { expect } from 'chai';
import { BaseConfig } from '../../BaseConfig';

describe('Monitoring and logging application validation', function () {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const cloudWatchClient: CloudWatchClient = new CloudWatchClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const cloudWatchLogsClient: CloudWatchLogsClient = new CloudWatchLogsClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const cloudTrailClient: CloudTrailClient = new CloudTrailClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  let ec2InstanceId: string = null;

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

    ({ InstanceId: ec2InstanceId } = ec2Instance.os);
  });

  it('the application EC2 instance should have CloudWatch integration', async () => {
    // Verify if metrics exist for EC2 instance
    const listMetricsData: ListMetricsCommandOutput = await cloudWatchClient.send(
      new ListMetricsCommand({
        Namespace: 'AWS/EC2',
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: ec2InstanceId,
          },
        ],
      }),
    );

    expect(listMetricsData.Metrics, 'CloudWatch has no metrics').to.be.an('array').that.is.not.empty;

    // Verify if log streams are updated in the log group
    const logGroupNames: string[] = await getLogGroupNames('/aws/lambda/cloudxserverless');

    expect(logGroupNames, "There is no '/aws/lambda/cloudxserverless' Log Group").to.be.an('array').that.is.not.empty;

    const allLogStreamsData: DescribeLogStreamsCommandOutput[] = await Promise.all(
      logGroupNames.map((logGroupName) => cloudWatchLogsClient.send(new DescribeLogStreamsCommand({ logGroupName }))),
    );

    allLogStreamsData
      .filter((logStreamsData: DescribeLogStreamsCommandOutput) => logStreamsData.logStreams.length)
      .forEach(
        (logStreamsData: DescribeLogStreamsCommandOutput) =>
          expect(
            logStreamsData.logStreams,
            `There are no Log Streams for '/aws/lambda/cloudxserverless' Log Group`,
          ).to.be.an('array').that.is.not.empty,
      );
  });

  it('CloudInit logs should be collected in CloudWatch logs', async () => {
    // Verify if log group exists for CloudInit logs
    const logGroupNames: string[] = await getLogGroupNames('/var/log/cloud-init');

    expect(logGroupNames, "There is no '/var/log/cloud-init' Log Group").to.be.an('array').that.is.not.empty;

    // Verify if log streams are updated in the log group for CloudInit logs
    const streamData: DescribeLogStreamsCommandOutput = await cloudWatchLogsClient.send(
      new DescribeLogStreamsCommand({
        logGroupName: logGroupNames[0],
      }),
    );

    // Verify if latest log stream has been updated within the last 60 minutes
    const now: number = Date.now();
    const SIXTY_MINUTES: number = 60 * 60 * 1000;
    const recentStream: Array<LogStream> = streamData.logStreams.filter((stream: LogStream) => {
      return now - stream.lastEventTimestamp <= SIXTY_MINUTES;
    });

    expect(recentStream, `There are no Log Streams for '/var/log/cloud-init' Log Group`).to.be.an('array').that.is.not
      .empty;
  });

  it('the application messages should be collected in CloudWatch logs', async () => {
    // Verify if log group exists for application messages
    const logGroupNames: string[] = await getLogGroupNames('/var/log/messages');

    expect(logGroupNames, "There is no '/var/log/messages' Log Group").to.be.an('array').that.is.not.empty;

    // Verify if log streams exist in the log group for the application messages
    const streamData: DescribeLogStreamsCommandOutput = await cloudWatchLogsClient.send(
      new DescribeLogStreamsCommand({
        logGroupName: logGroupNames[0],
      }),
    );

    expect(streamData.logStreams, `There are no Log Streams for '/var/log/messages' Log Group`).to.be.an('array').that
      .is.not.empty;
  });

  it('the event handler logs should be collected in CloudWatch logs', async () => {
    // Verify if log group exists for Event Handler
    const logGroupNames: string[] = await getLogGroupNames('/aws/lambda/cloudxserverless-EventHandlerLambda');

    expect(logGroupNames, "There is no '/aws/lambda/cloudxserverless-EventHandlerLambda' Log Group").to.be.an('array')
      .that.is.not.empty;

    // Verify if log streams exist in the log group for the Event Handler
    const allLogStreamsData: DescribeLogStreamsCommandOutput[] = await Promise.all(
      logGroupNames.map((logGroupName) => cloudWatchLogsClient.send(new DescribeLogStreamsCommand({ logGroupName }))),
    );

    allLogStreamsData
      .filter((logStreamsData: DescribeLogStreamsCommandOutput) => logStreamsData.logStreams.length)
      .forEach(
        (logStreamsData: DescribeLogStreamsCommandOutput) =>
          expect(
            logStreamsData.logStreams,
            `There are no Log Streams for '/aws/lambda/cloudxserverless-EventHandlerLambda' Log Group`,
          ).to.be.an('array').that.is.not.empty,
      );
  });

  it('CloudTrail should be enabled for Serverless stack and collects logs about AWS services access', async () => {
    const trailsData: DescribeTrailsCommandOutput = await cloudTrailClient.send(new DescribeTrailsCommand({}));

    const trailData: Trail = trailsData.trailList.find((trail: Trail) => {
      return trail.Name.includes('cloudxserverless-Trail');
    });

    expect(trailData.HomeRegion, 'HomeRegion is not correct').to.equal(region);
    expect(trailData.IncludeGlobalServiceEvents, 'IncludeGlobalServiceEvents is not correct').to.be.true;
    expect(trailData.IsMultiRegionTrail, 'IsMultiRegionTrail is not correct').to.be.true;
    expect(trailData.IsOrganizationTrail, 'IsOrganizationTrail is not correct').to.be.false;
    expect(trailData.LogFileValidationEnabled, 'LogFileValidationEnabled is not correct').to.be.true;

    // Verify if the trail is enabled and logging
    const trailStatusData: GetTrailStatusCommandOutput = await cloudTrailClient.send(
      new GetTrailStatusCommand({ Name: trailData.TrailARN }),
    );

    expect(trailStatusData.IsLogging, 'IsLogging is not correct').to.be.true;
  });

  it('CloudWatch requirements (LogGroups)', async () => {
    const logGroupsData: DescribeLogGroupsCommandOutput = await cloudWatchLogsClient.send(
      new DescribeLogGroupsCommand({}),
    );

    // Verify if log group exists for Lambda function
    const lambdaLogGroup: LogGroup = logGroupsData.logGroups.find((group: LogGroup) => {
      return group.logGroupName.startsWith('/aws/lambda/cloudxserverless-EventHandlerLambda');
    });

    expect(lambdaLogGroup, 'No log group exists for Lambda function').not.to.be.null;

    // Verify if log group exists for application logs
    const applicationLogGroup: LogGroup = logGroupsData.logGroups.find((group) => {
      return group.logGroupName.includes('/var/log/cloudxserverless-app');
    });

    expect(applicationLogGroup, 'No log group exists for application').not.to.be.null;

    // Verify if there are log streams in application log group
    const streamData: DescribeLogStreamsCommandOutput = await cloudWatchLogsClient.send(
      new DescribeLogStreamsCommand({ logGroupName: applicationLogGroup.logGroupName }),
    );

    expect(streamData.logStreams, `There are no Log Streams for the application Log Group`).to.be.an('array').that.is
      .not.empty;

    // Verify if log group exists for cloud-init logs
    const cloudInitLogGroup = logGroupsData.logGroups.find((group) => {
      return group.logGroupName === '/var/log/cloud-init';
    });

    expect(cloudInitLogGroup, 'No log group exists for cloud-init').not.to.be.null;
  });

  it('CloudTrail trail requirements', async () => {
    const trailsData: DescribeTrailsCommandOutput = await cloudTrailClient.send(new DescribeTrailsCommand({}));

    const trailData: Trail = trailsData.trailList.find((trail: Trail) => {
      return trail.Name.includes('cloudxserverless-Trail');
    });

    // Verify if CloudTrail "cloudxserverless-Trail" exists
    expect(trailData, 'CloudTrail "cloudxserverless-Trail" does not exist').to.exist;

    const getTrailCommand: GetTrailCommandOutput = await cloudTrailClient.send(
      new GetTrailCommand({ Name: trailData.Name }),
    );

    // Verify if CloudTrail is set to multi-region
    expect(getTrailCommand.Trail.IsMultiRegionTrail, 'CloudTrail is not set to multi-region').to.be.true;

    // Verify if log file validation is enabled for CloudTrail
    expect(getTrailCommand.Trail.LogFileValidationEnabled, 'Log file validation is not enabled for CloudTrail').to.be
      .true;

    // Verify if the SSE-KMS encryption is not enabled for a CloudTrail
    expect(trailData.KmsKeyId, 'the SSE-KMS encryption is enabled for a CloudTrail').to.be.undefined;

    // Verify if the trail has a specific tag for a CloudTrail
    const tagsData: ListTagsCommandOutput = await cloudTrailClient.send(
      new ListTagsCommand({ ResourceIdList: [trailData.TrailARN] }),
    );

    expect(
      tagsData.ResourceTagList[0].TagsList.find((tag) => tag.Key === 'cloudx').Value,
      `Tag 'cloudx' is not correct`,
    ).to.equal('qa');
  });

  async function getLogGroupNames(logGroupNamePrefix: string): Promise<Array<string>> {
    const params: DescribeLogGroupsCommandInput = {};
    let logGroups: LogGroup[] = [];
    let logGroupsData: DescribeLogGroupsCommandOutput = null;

    do {
      logGroupsData = await cloudWatchLogsClient.send(new DescribeLogGroupsCommand(params));
      logGroups = [...logGroups, ...logGroupsData.logGroups];
      params.nextToken = logGroupsData.nextToken;
    } while (logGroupsData.nextToken);

    return logGroups
      .filter((group: LogGroup) => group.logGroupName.includes(logGroupNamePrefix))
      .map(({ logGroupName }) => logGroupName);
  }
});
