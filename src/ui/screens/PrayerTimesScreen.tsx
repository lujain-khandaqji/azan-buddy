import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PRAYER_NAMES, PrayerName } from '../../domain/services/prayerTimesService';
import { usePrayerTimesScreen } from '../hooks/usePrayerTimesScreen';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function PrayerTimesScreen() {
  const {
    prayerTimes,
    nextPrayer,
    countdownLabel,
    cityLabel,
    currentPrayer,
    isCurrentPrayerConfirmed,
    confirming,
    confirmError,
    confirmCurrentPrayer,
    loading,
    error,
  } = usePrayerTimesScreen();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>Loading today's prayer times…</Text>
      </View>
    );
  }

  if (error || !prayerTimes) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn't load prayer times{error ? `: ${error}` : '.'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today's Prayers</Text>
      <Text style={styles.subtitle}>{cityLabel}</Text>

      <View style={styles.countdownBox}>
        {nextPrayer ? (
          <>
            <Text style={styles.countdownLabel}>Next: {nextPrayer.name}</Text>
            <Text style={styles.countdownValue}>{countdownLabel}</Text>
          </>
        ) : (
          <Text style={styles.countdownLabel}>No more prayers remaining today</Text>
        )}
      </View>

      {currentPrayer && (
        <Pressable
          onPress={confirmCurrentPrayer}
          disabled={confirming || isCurrentPrayerConfirmed}
          style={[styles.confirmButton, isCurrentPrayerConfirmed && styles.confirmButtonDone]}
        >
          {confirming ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.confirmButtonText}>
              {isCurrentPrayerConfirmed ? `${currentPrayer.name} confirmed ✓` : `I prayed ${currentPrayer.name}`}
            </Text>
          )}
        </Pressable>
      )}
      {confirmError && <Text style={styles.confirmErrorText}>{confirmError}</Text>}

      <View style={styles.list}>
        {PRAYER_NAMES.map((name: PrayerName) => {
          const isNext = nextPrayer?.name === name;
          return (
            <View key={name} style={[styles.row, isNext && styles.rowHighlighted]}>
              <Text style={[styles.prayerName, isNext && styles.prayerNameHighlighted]}>{name}</Text>
              <Text style={[styles.prayerTime, isNext && styles.prayerTimeHighlighted]}>
                {formatTime(prayerTimes[name])}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 20 },
  centered: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  statusText: { marginTop: 12, fontSize: 16, color: '#555' },
  errorText: { fontSize: 16, color: '#b00020', textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#777', marginTop: 2, marginBottom: 20 },
  countdownBox: {
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  countdownLabel: { color: '#e6fffa', fontSize: 16, fontWeight: '600' },
  countdownValue: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '800',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  confirmButton: {
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  confirmButtonDone: { backgroundColor: '#9ca3af' },
  confirmButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  confirmErrorText: { color: '#b00020', fontSize: 13, marginBottom: 12 },
  list: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  rowHighlighted: { backgroundColor: '#ccfbf1' },
  prayerName: { fontSize: 17, color: '#333', fontWeight: '500' },
  prayerNameHighlighted: { color: '#0f766e', fontWeight: '700' },
  prayerTime: { fontSize: 17, color: '#333' },
  prayerTimeHighlighted: { color: '#0f766e', fontWeight: '700' },
});
