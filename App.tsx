import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import PrayerTimesScreen from './src/ui/screens/PrayerTimesScreen';
import RemindersScreen from './src/ui/screens/RemindersScreen';

type Tab = 'prayerTimes' | 'reminders';

export default function App() {
  const [tab, setTab] = useState<Tab>('prayerTimes');

  return (
    <View style={styles.container}>
      <View style={styles.screen}>{tab === 'prayerTimes' ? <PrayerTimesScreen /> : <RemindersScreen />}</View>
      <View style={styles.tabBar}>
        <Pressable style={styles.tab} onPress={() => setTab('prayerTimes')}>
          <Text style={[styles.tabLabel, tab === 'prayerTimes' && styles.tabLabelActive]}>Prayer Times</Text>
        </Pressable>
        <Pressable style={styles.tab} onPress={() => setTab('reminders')}>
          <Text style={[styles.tabLabel, tab === 'reminders' && styles.tabLabelActive]}>Reminders</Text>
        </Pressable>
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
