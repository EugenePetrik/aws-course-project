import { expect } from 'chai';
import { EC2Client, DescribeInstancesCommand, DescribeVpcsCommand, DescribeSubnetsCommand } from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

describe('VPC', () => {
  const { accessKeyId, secretAccessKey, region } = BaseConfig;

  let vpcId: string = null;

  // Configure AWS SDK
  const ec2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

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

    // Retrieve VPC ID for an instance
    vpcId = deployedInstances.find((instance) => instance.type === 'public').os.VpcId;
  });

  it('should be deployed in non-default VPC', async () => {
    // Retrieve information about all VPCs
    const vpcs = await ec2Client.send(new DescribeVpcsCommand({}));

    // Check if there are two VPCs
    expect(vpcs.Vpcs, 'The number of VPCs is not correct').to.be.an('array').with.lengthOf(2);

    // Check if there is one non-default VPC
    const nonDefaultVpcs = vpcs.Vpcs.filter((vpc) => !vpc.IsDefault);
    expect(nonDefaultVpcs, 'There is no non-default VPC').to.be.an('array').that.is.not.empty;
  });

  it('should have two subnets: public and private', async () => {
    // Check subnets in the non-default VPC
    const subnets = await ec2Client.send(
      new DescribeSubnetsCommand({ Filters: [{ Name: 'vpc-id', Values: [vpcId] }] }),
    );

    // Check if there are exactly two subnets
    expect(subnets.Subnets, 'The number of subnets is not correct').to.be.an('array').with.lengthOf(2);

    // Check if there are subnets types
    const subnetTags = subnets.Subnets.map(
      (subnet) => subnet.Tags.find(({ Key }) => Key === 'aws-cdk:subnet-type')?.Value,
    );
    expect(subnetTags, 'Subnet type is not correct').to.have.members(['Public', 'Private']);
  });

  it('should have CIDR block 10.0.0.0/16', async () => {
    // Extract relevant information about the VPC
    const vpcs = await ec2Client.send(
      new DescribeVpcsCommand({
        VpcIds: [vpcId],
      }),
    );

    expect(vpcs.Vpcs[0].CidrBlock, 'VPC CIDR Block is not correct').to.equal('10.0.0.0/16');
  });

  it('should have Name and cloudx tags', async () => {
    // Extract relevant information about the VPC
    const vpcs = await ec2Client.send(
      new DescribeVpcsCommand({
        VpcIds: [vpcId],
      }),
    );

    expect(vpcs.Vpcs[0].Tags.find(({ Key }) => Key === 'Name').Value, `Tag 'Name' is not correct`).to.equal(
      'cloudxinfo/Network/Vpc',
    );

    expect(vpcs.Vpcs[0].Tags.find(({ Key }) => Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal('qa');
  });
});
