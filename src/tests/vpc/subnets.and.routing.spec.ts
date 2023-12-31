import { expect } from 'chai';
import {
  EC2Client,
  DescribeSubnetsCommand,
  DescribeRouteTablesCommand,
  DescribeInternetGatewaysCommand,
  Subnet,
  type DescribeSubnetsCommandOutput,
  type DescribeRouteTablesCommandOutput,
  type Route,
  type DescribeInternetGatewaysCommandOutput,
} from '@aws-sdk/client-ec2';
import { BaseConfig } from '../../BaseConfig';

const { accessKeyId, secretAccessKey, region } = BaseConfig;

describe('Subnets and routing', () => {
  let publicSubnet: Subnet = null;
  let privateSubnet: Subnet = null;

  const ec2Client: EC2Client = new EC2Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  before(async () => {
    const subnets: DescribeSubnetsCommandOutput = await ec2Client.send(new DescribeSubnetsCommand({}));

    publicSubnet = subnets.Subnets.filter(({ Tags }) => Tags).find((subnet) =>
      subnet.Tags.find(({ Key, Value }) => Key === 'aws-cdk:subnet-name' && Value === 'PublicSubnet'),
    );

    privateSubnet = subnets.Subnets.filter(({ Tags }) => Tags).find((subnet) =>
      subnet.Tags.find(({ Key, Value }) => Key === 'aws-cdk:subnet-name' && Value === 'PrivateSubnet'),
    );
  });

  it('public subnet should be accessible from the internet via an Internet Gateway', async () => {
    expect(publicSubnet.SubnetId, 'Public subnet ID not found.').to.exist.and.not.be.empty;

    const routeTablesResult: DescribeRouteTablesCommandOutput = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'association.subnet-id', Values: [publicSubnet.SubnetId] }],
      }),
    );

    // Find a route with destination 0.0.0.0/0 which indicates it routes internet traffic
    const internetRoute: Route = routeTablesResult.RouteTables[0].Routes.find(
      (route) => route.DestinationCidrBlock === '0.0.0.0/0',
    );

    // Check if the route exists and the GatewayId parameter starts with "igw-", which indicates an Internet Gateway
    expect(internetRoute, 'Route does not exist').to.be.an('object').to.exist.and.not.be.empty;
    expect(internetRoute.GatewayId, 'Gateway ID is not correct').to.match(/^igw-/);

    // Check if the Internet Gateway exists and is attached to the VPC
    const internetGatewaysResult: DescribeInternetGatewaysCommandOutput = await ec2Client.send(
      new DescribeInternetGatewaysCommand({
        Filters: [{ Name: 'internet-gateway-id', Values: [internetRoute.GatewayId] }],
      }),
    );

    expect(internetGatewaysResult.InternetGateways, 'Internet gateways do not exist').to.be.an('array').and.not.be
      .empty;
    expect(
      internetGatewaysResult.InternetGateways[0].Attachments[0].State,
      'Internet gateways Attachments.State is not correct',
    ).to.equal('available');
    expect(
      internetGatewaysResult.InternetGateways[0].Attachments[0].VpcId,
      'Internet gateways Attachments.VpcId is not correct',
    ).to.equal(publicSubnet.VpcId);
  });

  it('public and private subnets should be in the same VPC', () => {
    // Check if both subnets are in the same VPC
    expect(publicSubnet.VpcId, 'Subnets are in the different VPCs').to.equal(privateSubnet.VpcId);
  });

  it('public subnet should have local routes to the private subnet', async () => {
    // Check route tables for local routes
    const routeTablesResult: DescribeRouteTablesCommandOutput = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'vpc-id', Values: [publicSubnet.VpcId] }],
      }),
    );

    routeTablesResult.RouteTables.forEach((routeTable) => {
      const localRoute = routeTable.Routes.find((route) => route.GatewayId === 'local');
      expect(localRoute, 'Local route does not exist').to.be.an('object').and.not.be.empty;
    });
  });

  it('private subnet should have access to the internet via a NAT Gateway', async () => {
    if (!privateSubnet) {
      throw new Error('Private subnet should exist.');
    }

    const routeTables: DescribeRouteTablesCommandOutput = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'association.subnet-id', Values: [privateSubnet.SubnetId] }],
      }),
    );

    if (!routeTables.RouteTables.length) {
      throw new Error('No Route Table found for the private subnet.');
    }

    const internetRoute: Route = routeTables.RouteTables[0].Routes.find(
      (route) => route.DestinationCidrBlock === '0.0.0.0/0',
    );

    // Check if the route exists and if the NatGatewayId parameter starts with "nat-", which indicates a NAT Gateway
    expect(internetRoute, 'Route does not exist').to.be.an('object').and.not.be.empty;
    expect(internetRoute.NatGatewayId, 'Route NatGatewayId is not correct').to.match(/^nat-/);
  });

  it('private subnet should not have direct access to the public internet via an Internet Gateway', async () => {
    if (!privateSubnet) {
      throw new Error('Private subnet should exist.');
    }

    const routeTables: DescribeRouteTablesCommandOutput = await ec2Client.send(
      new DescribeRouteTablesCommand({
        Filters: [{ Name: 'association.subnet-id', Values: [privateSubnet.SubnetId] }],
      }),
    );

    if (!routeTables.RouteTables.length) {
      throw new Error('No Route Table found for the private subnet.');
    }

    const internetRoute: Route = routeTables.RouteTables[0].Routes.find(
      (route) => route.DestinationCidrBlock === '0.0.0.0/0',
    );

    // Check if the route does not exist or if the GatewayId does NOT start with "igw-", which indicates an Internet Gateway
    expect(internetRoute.GatewayId, 'Route GatewayId is not correct').to.not.match(/^igw-/);
  });
});
