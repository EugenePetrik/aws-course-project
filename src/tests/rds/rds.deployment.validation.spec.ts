import { expect } from 'chai';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  type VpcSecurityGroupMembership,
  type DescribeDBInstancesCommandOutput,
  type DBInstance,
  type Subnet,
} from '@aws-sdk/client-rds';
import mysql, { type Connection } from 'mysql2/promise';
import { BaseConfig } from '../../BaseConfig';

describe('RDS deployment validation', () => {
  const { region, dbUsername: user, dbPassword: password, dbName: database, dbPort: port } = BaseConfig;

  const rdsClient: RDSClient = new RDSClient({ region });

  const rdsPrefix: string = 'cloudximage-databasemysqlinstanced';

  let rdsInstance: DBInstance = null;

  before(async () => {
    const command: DescribeDBInstancesCommand = new DescribeDBInstancesCommand({});
    const response: DescribeDBInstancesCommandOutput = await rdsClient.send(command);
    const rdsInstances: DBInstance[] = response.DBInstances;

    rdsInstance = rdsInstances.find((rds) => rds.DBInstanceIdentifier.includes(rdsPrefix));

    if (!rdsInstance) throw new Error(`No MySQL RDS found with prefix: ${rdsPrefix}`);
  });

  it('the MySQL RDS instance is deployed in the private subnet and accessible only from application subnet', async () => {
    expect(rdsInstance.VpcSecurityGroups.length, 'should have at least one VPC Security Group').to.be.greaterThan(0);

    // Security group assertions
    const securityGroup: VpcSecurityGroupMembership = rdsInstance.VpcSecurityGroups[0];
    expect(securityGroup.Status, 'VPC Security Groups Status is not correct').to.equal('active');

    // VPC and Subnet assertions
    expect(rdsInstance.PubliclyAccessible, 'RDS instance is publicly accessible').to.be.false;

    // Subnet assertions
    expect(rdsInstance.DBSubnetGroup.VpcId, 'DBSubnetGroup VpcId is not correct').to.exist.and.not.be.empty;
    expect(
      rdsInstance.DBSubnetGroup.DBSubnetGroupDescription,
      'DBSubnetGroup DBSubnetGroupDescription is not correct',
    ).to.equal('Subnet group for MySQLInstance database');

    const subnets: Subnet[] = rdsInstance.DBSubnetGroup.Subnets;
    expect(subnets, 'There are no subnets').to.be.an('array').that.is.not.empty;
    expect(
      subnets.every(({ SubnetStatus }) => SubnetStatus === 'Active'),
      'Some subnets are not active',
    ).to.be.true;

    let connection: Connection = null;
    const rdsEndpoint: string = rdsInstance.Endpoint.Address;

    try {
      connection = await mysql.createConnection({
        host: rdsEndpoint,
        database,
        user,
        password,
        port: Number(port),
      });

      await connection.execute('SHOW TABLES;');

      expect.fail(`Successfully connected to ${rdsInstance.DBInstanceIdentifier} at ${rdsEndpoint}.`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(`Failed to connect to ${rdsInstance.DBInstanceIdentifier} (expected).`);
      expect(JSON.stringify(error)).to.equal('{"message":"connect ETIMEDOUT","code":"ETIMEDOUT"}');
    } finally {
      if (connection && connection.end) {
        await connection.end();
      }
    }
  });

  it('checks RDS MySQL instance properties', () => {
    expect(rdsInstance.DBInstanceClass).to.equal('db.t3.micro');
    expect(rdsInstance.MultiAZ).to.be.false;
    expect(rdsInstance.AllocatedStorage).to.equal(100);
    expect(rdsInstance.StorageType).to.equal('gp2');
    expect(rdsInstance.StorageEncrypted).to.be.false;
    expect(rdsInstance.Engine).to.equal('mysql');
    expect(rdsInstance.EngineVersion).to.equal('8.0.28');

    expect(rdsInstance.TagList.find((tag) => tag.Key === 'cloudx').Value, `Tag 'cloudx' is not correct`).to.equal('qa');
  });
});
