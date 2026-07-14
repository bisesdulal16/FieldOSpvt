module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Required for react-native-vision-camera frame processors (face scan + tflite).
    // Keep this LAST in the plugins list.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
