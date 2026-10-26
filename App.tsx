import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import PrayerTimesScreen from './src/ui/screens/PrayerTimesScreen';
import RemindersScreen from './src/ui/screens/RemindersScreen';
import HistoryDashboardScreen from './src/ui/screens/HistoryDashboardScreen';
import CoachingScreen from './src/ui/screens/CoachingScreen';
import MicButton from './src/ui/components/MicButton';
import { useVoiceSession } from './src/voice/useVoiceSession';

type Tab = 'prayerTimes' | 'reminders' | 'history' | 'coaching';

const SCREENS: Record<Tab, React.ComponentType> = {
  prayerTimes: PrayerTimesScreen,
  reminders: RemindersScreen,
  history: HistoryDashboardScreen,
  coaching: CoachingScreen,
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'prayerTimes', label: 'Prayer Times' },
  { key: 'reminders', label: 'Reminders' },
  { key: 'history', label: 'History' },
  { key: 'coaching', label: 'Coaching' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('prayerTimes');
  const ActiveScreen = SCREENS[tab];
  const voice = useVoiceSession();

  return (
    <View style={styles.container}>
      <View style={styles.screen}>
        {/* Remounting after a voice write makes the screen re-read the same services. */}
        <ActiveScreen key={voice.dataVersion} />
      </View>
      <MicButton state={voice.state} onPress={voice.toggleMic} />
      <View style={styles.tabBar}>
        {TABS.map(({ key, label }) => (
          <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
            <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingBottom: 24,
    paddingTop: 10,
    backgroundColor: '#fff',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabLabel: { fontSize: 14, color: '#777', fontWeight: '500' },
  tabLabelActive: { color: '#0f766e', fontWeight: '700' },
});
