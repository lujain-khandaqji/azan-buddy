import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { PRAYER_NAMES, PrayerName } from '../../domain/services/prayerTimesService';
import { PrayerLogStatus } from '../../domain/services/prayerLogService';
import { usePrayerTimesScreen } from '../hooks/usePrayerTimesScreen';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS: Record<PrayerLogStatus, string> = {
  on_time: 'On time',
  late: 'Late',
  qada: 'Qada',
  missed: 'Missed',
  not_yet: 'Not yet',
};

export default function PrayerTimesScreen() {
  const {
    prayerTimes,
    nextPrayer,
    countdownLabel,
    cityLabel,
    currentPrayer,
    statusByPrayer,
    isCurrentPrayerConfirmed,
    confirming,
    confirmError,
    confirmCurrentPrayer,
    loading,
    error,
    coachingReply,
    coachingSending,
    coachingError,
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

  const currentStatus = currentPrayer ? statusByPrayer[currentPrayer.name] : undefined;

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
        <>
          {!isCurrentPrayerConfirmed && currentStatus === 'missed' && (
            <Text style={styles.missedBadge}>
              {currentPrayer.name} missed — you can still log it as qada
            </Text>
          )}
          <Pressable
            onPress={confirmCurrentPrayer}
            disabled={confirming || isCurrentPrayerConfirmed}
            style={[styles.confirmButton, isCurrentPrayerConfirmed && styles.confirmButtonDone]}
          >
            {confirming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmButtonText}>
                {isCurrentPrayerConfirmed && currentStatus
                  ? `${currentPrayer.name}: ${STATUS_LABELS[currentStatus]}`
                  : `I prayed ${currentPrayer.name}`}
              </Text>
            )}
          </Pressable>
        </>
      )}
      {confirmError && <Text style={styles.confirmErrorText}>{confirmError}</Text>}

      {(coachingSending || coachingReply) && (
        <View style={styles.nafyCard}>
          <Text style={styles.nafyLabel}>Nafy</Text>
          {coachingSending && !coachingReply ? (
            <ActivityIndicator color="#0f766e" size="small" />
          ) : (
            coachingReply && <Text style={styles.nafyText}>{coachingReply.text}</Text>
          )}
        </View>
      )}
      {coachingError && <Text style={styles.confirmErrorText}>{coachingError}</Text>}

      <View style={styles.list}>
        {PRAYER_NAMES.map((name: PrayerName) => {
          const isNext = nextPrayer?.name === name;
          const status = statusByPrayer[name];
          return (
            <View key={name} style={[styles.row, isNext && styles.rowHighlighted]}>
              <Text style={[styles.prayerName, isNext && styles.prayerNameHighlighted]}>{name}</Text>
              <View style={styles.rowRight}>
                {status && status !== 'not_yet' && (
                  <Text style={[styles.statusBadge, STATUS_BADGE_STYLE[status]]}>{STATUS_LABELS[status]}</Text>
                )}
                <Text style={[styles.prayerTime, isNext && styles.prayerTimeHighlighted]}>
                  {formatTime(prayerTimes[name])}
                </Text>
              </View>
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
  missedBadge: { color: '#b00020', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  nafyCard: {
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#ccfbf1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  nafyLabel: { color: '#0f766e', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  nafyText: { color: '#134e4a', fontSize: 15, lineHeight: 20 },
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
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  prayerName: { fontSize: 17, color: '#333', fontWeight: '500' },
  prayerNameHighlighted: { color: '#0f766e', fontWeight: '700' },
  prayerTime: { fontSize: 17, color: '#333' },
  prayerTimeHighlighted: { color: '#0f766e', fontWeight: '700' },
  statusBadge: { fontSize: 12, fontWeight: '700', marginRight: 8 },
  statusOnTime: { color: '#15803d' },
  statusLate: { color: '#b45309' },
  statusQada: { color: '#c2410c' },
  statusMissed: { color: '#b00020' },
});

const STATUS_BADGE_STYLE: Record<Exclude<PrayerLogStatus, 'not_yet'>, object> = {
  on_time: styles.statusOnTime,
  late: styles.statusLate,
  qada: styles.statusQada,
  missed: styles.statusMissed,
};
