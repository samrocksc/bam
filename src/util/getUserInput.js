const readline = require('readline');

const { bamText, bamWarn } = require('./fancyText.js');

const answers = [];

const asyncValidate = async (asyncCallback, validator, feedback, question, defaultAnswer) => {
  while (true) {
    const result = await asyncCallback(question, defaultAnswer);
    const validAnswer = await validator(result);
    if (validAnswer) return result;
    bamWarn(feedback);
  }
};

module.exports = async function getUserInput(prompts) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // returns a pending prompt promise to handle single attempt at a question
  const pendingPrompt = (question, defaultAnswer) => (
    new Promise((resolve) => {
      rl.question(bamText(question), resolve);
      rl.write(defaultAnswer);
    })
  );

  for (let i = 0; i < prompts.length; i += 1) {
    const { question, validator, feedback, defaultAnswer } = prompts[i];
    const answer = await asyncValidate(pendingPrompt, validator, feedback, question, defaultAnswer);
    answers.push(answer);
  }

  rl.close();
  return answers;
};
