import { expect } from 'chai';
import { EC2Client, DescribeInstancesCommand, DescribeVpcsCommand, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

describe('VPC', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  it('The application should be deployed in non-default VPC', async () => {
    // Configure AWS SDK
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Retrieve information about all VPCs
    const vpcs = await ec2Client.send(new DescribeVpcsCommand({}));

    // Check if there are two VPCs
    expect(vpcs.Vpcs, 'The number of VPCs is not correct').to.be.an('array').with.lengthOf(2);
  });

  it('The application should be deployed in non-default VPC and has 2 subnets', async () => {
    // Configure AWS SDK
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get information about instances
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const instances = await ec2Client.send(new DescribeInstancesCommand(params));

    // Extract relevant information about the instances
    const deployedInstances = instances.Reservations.reduce((acc, reservation) => {
      return acc.concat(
        reservation.Instances.map((instance) => ({
          id: instance.InstanceId,
          type: instance.PublicIpAddress ? 'public' : 'private',
          os: instance,
        })),
      );
    }, []);

    // Retrieve VPC ID for deployed public instance
    const vpcId = deployedInstances.find((instance) => instance.type === 'public').os.VpcId;

    // Check subnets in the non-default VPC
    const subnets = await ec2Client.send(
      new DescribeSubnetsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }),
    );

    // Check if there are exactly two subnets
    expect(subnets.Subnets, 'The number of subnets is not correct').to.be.an('array').with.lengthOf(2);
  });

  it('Should return VPC CIDR Block and VPC tags', async () => {
    // Configure AWS SDK
    const ec2Client = new EC2Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get information about instances
    const params = {
      Filters: [
        {
          Name: 'instance-state-name',
          Values: ['running'],
        },
      ],
    };

    const instances = await ec2Client.send(new DescribeInstancesCommand(params));

    // Extract relevant information about the instances
    const deployedInstances = instances.Reservations.reduce((acc, reservation) => {
      return acc.concat(
        reservation.Instances.map((instance) => ({
          type: instance.PublicIpAddress ? 'public' : 'private',
          os: instance,
        })),
      );
    }, []);

    // Retrieve VPC ID for deployed public instance
    const vpcId = deployedInstances.find((instance) => instance.type === 'public').os.VpcId;

    // Extract relevant information about the VPC
    const describeVpcsCommand = new DescribeVpcsCommand({
      VpcIds: [vpcId],
    });

    const vpcs = await ec2Client.send(describeVpcsCommand);

    expect(vpcs.Vpcs[0].CidrBlock, 'VPC CIDR Block is not correct').to.equal('10.0.0.0/16');
    expect(vpcs.Vpcs[0].Tags.find((tag) => tag.Key === 'Name').Value, `Tag 'Name' is not correct`).to.equal(
      'cloudxinfo/Network/Vpc',
    );
    expect(vpcs.Vpcs[0].Tags.find((tag) => tag.Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal('qa');
  });
});
