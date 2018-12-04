module.exports = function checkForOptionType(options, type) {
  const optionsKeys = Object.keys(options);
  const regEx = new RegExp(`${type}`);
  return optionsKeys.some(optionKey => regEx.test(optionKey));
};
