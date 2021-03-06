const { readConfig, readFile } = require('../util/fileUtils');
const bamSpinner = require('../util/spinner');

const {
  doesRoleExist,
  doesPolicyExist,
  isPolicyAttached,
} = require('./doesResourceExist');

const {
  asyncCreatePolicy,
  asyncCreateRole,
  asyncAttachPolicy,
} = require('./awsFunctions');

const {
  msgAfterAction,
  bamLog,
  bamError,
} = require('../util/logger');

const AWSLambdaBasicExecutionRolePolicyARN = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';
const AWSLambdaRolePolicyARN = 'arn:aws:iam::aws:policy/service-role/AWSLambdaRole';

const rolePolicy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: {
        Service: 'lambda.amazonaws.com',
      },
      Action: 'sts:AssumeRole',
    },
  ],
};

const getAttachParams = (roleName, policyArn) => (
  {
    RoleName: roleName,
    PolicyArn: policyArn,
  }
);

const getRoleParams = roleName => (
  {
    RoleName: roleName,
    AssumeRolePolicyDocument: JSON.stringify(rolePolicy),
  }
);

const createRole = async (roleName) => {
  const roleParams = getRoleParams(roleName);
  const doesRoleNameExist = await doesRoleExist(roleName);
  if (!doesRoleNameExist) {
    await asyncCreateRole(roleParams);
    bamSpinner.stop();
    bamLog(msgAfterAction('role', roleName, 'created'));
  }
};

const createDatabaseBamRolePolicy = async (databasePolicyName, databasePolicyArn) => {
  const doesDatabasePolicyExist = await doesPolicyExist(databasePolicyArn);

  if (!doesDatabasePolicyExist) {
    const policyDocumentJSON = await readFile(`${__dirname}/../../templates/databaseBamRolePolicy.json`, 'utf8');
    const policyDocument = JSON.stringify(JSON.parse(policyDocumentJSON));

    const policyParams = {
      PolicyName: databasePolicyName,
      PolicyDocument: policyDocument,
    };

    await asyncCreatePolicy(policyParams);
  }
};

const attachPolicy = async (roleName, policyArn) => {
  const isAwsPolicyAttached = await isPolicyAttached(roleName, policyArn);
  if (!isAwsPolicyAttached) {
    const attachedParams = getAttachParams(roleName, policyArn);
    await asyncAttachPolicy(attachedParams);
  }
};

const createBamRole = async (roleName) => {
  bamSpinner.start();
  try {
    await createRole(roleName);
    await attachPolicy(roleName, AWSLambdaBasicExecutionRolePolicyARN);
    await attachPolicy(roleName, AWSLambdaRolePolicyARN);
    bamSpinner.stop();
  } catch (err) {
    bamSpinner.stop();
    bamError(err);
  }
};

const createDatabaseBamRole = async (databaseBamRole, path) => {
  bamSpinner.start();

  const config = await readConfig(path);
  const { accountNumber } = config;
  const databasePolicyName = `${databaseBamRole}Policy`;
  const databasePolicyArn = `arn:aws:iam::${accountNumber}:policy/${databasePolicyName}`;

  try {
    await createRole(databaseBamRole);
    await createDatabaseBamRolePolicy(databasePolicyName, databasePolicyArn);
    await attachPolicy(databaseBamRole, databasePolicyArn);
    await attachPolicy(databaseBamRole, AWSLambdaRolePolicyARN);
    bamSpinner.stop();
  } catch (err) {
    bamSpinner.stop();
    bamError(err);
  }
};

module.exports = {
  createBamRole,
  createDatabaseBamRole,
};
