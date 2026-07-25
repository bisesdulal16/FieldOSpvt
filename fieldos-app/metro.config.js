// Metro config — extends Expo's defaults.
// Registers `.tflite` as a bundleable asset so the face-embedding model
// (assets/models/mobilefacenet.tflite) ships INSIDE the APK and loads with
// no network. Without this, react-native-fast-tflite's require('*.tflite')
// can't resolve and the model has to be downloaded at runtime (the pilot's
// "stuck on Loading face model…" hang when the homelab is unreachable).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('tflite')) {
  config.resolver.assetExts.push('tflite');
}

module.exports = config;
