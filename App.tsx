import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import PrayerTimesScreen from './src/ui/screens/PrayerTimesScreen';

export default function App() {
  return (
    <View style={{ flex: 1 }}>
      <PrayerTimesScreen />
      <StatusBar style="auto" />
    </View>
  );
}
