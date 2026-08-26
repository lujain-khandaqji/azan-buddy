import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PRAYER_NAMES, PrayerName } from '../../domain/services/prayerTimesService';
import { ReminderScope } from '../../domain/services/reminderService';
import { useReminders } from '../hooks/useReminders';

const SCOPES: ReminderScope[] = ['today', 'always'];
const SCOPE_LABELS: Record<ReminderScope, string> = { today: 'Today', always: 'Always' };

export default function RemindersScreen() {
  const { reminders, loading, error, saving, saveError, createReminder, cancelReminder } = useReminders();

  const [selectedPrayer, setSelectedPrayer] = useState<PrayerName>(PRAYER_NAMES[0]);
  const [offsetText, setOffsetText] = useState('');
  const [scope, setScope] = useState<ReminderScope>('today');

  const offsetMinutes = Number(offsetText);
  const isOffsetValid = offsetText.trim().length > 0 && Number.isInteger(offsetMinutes) && offsetMinutes > 0;

  async function handleSave() {
    if (!isOffsetValid || saving) return;
    await createReminder(selectedPrayer, offsetMinutes, scope);
    setOffsetText('');
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Reminders</Text>

      <Text style={styles.sectionLabel}>Prayer</Text>
      <View style={styles.pillRow}>
        {PRAYER_NAMES.map((name) => (
          <Pressable
            key={name}
            onPress={() => setSelectedPrayer(name)}
            style={[styles.pill, selectedPrayer === name && styles.pillSelected]}
          >
            <Text style={[styles.pillText, selectedPrayer === name && styles.pillTextSelected]}>{name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Minutes before</Text>
      <TextInput
        value={offsetText}
        onChangeText={setOffsetText}
        placeholder="e.g. 15"
        keyboardType="number-pad"
        style={styles.input}
      />

      <Text style={styles.sectionLabel}>Repeat</Text>
      <View style={styles.pillRow}>
        {SCOPES.map((s) => (
          <Pressable key={s} onPress={() => setScope(s)} style={[styles.pill, scope === s && styles.pillSelected]}>
            <Text style={[styles.pillText, scope === s && styles.pillTextSelected]}>{SCOPE_LABELS[s]}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={handleSave}
        disabled={!isOffsetValid || saving}
        style={[styles.saveButton, (!isOffsetValid || saving) && styles.saveButtonDisabled]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save Reminder</Text>}
      </Pressable>
      {saveError && <Text style={styles.errorText}>{saveError}</Text>}

      <Text style={styles.sectionLabel}>Your Reminders</Text>
      {loading ? (
        <ActivityIndicator style={styles.listLoading} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : reminders.length === 0 ? (
        <Text style={styles.emptyText}>No reminders yet</Text>
      ) : (
        <View style={styles.list}>
          {reminders.map((reminder) => (
            <View key={reminder.id} style={styles.row}>
              <View>
                <Text style={styles.rowTitle}>{reminder.prayerName}</Text>
                <Text style={styles.rowSubtitle}>
                  {reminder.offsetMinutes} min before • {SCOPE_LABELS[reminder.scope]}
                </Text>
              </View>
              <Pressable onPress={() => cancelReminder(reminder.id)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a', marginBottom: 20 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: '#777', marginTop: 20, marginBottom: 8 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  pillSelected: { backgroundColor: '#0f766e', borderColor: '#0f766e' },
  pillText: { fontSize: 14, color: '#333', fontWeight: '500' },
  pillTextSelected: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#1a1a1a',
  },
  saveButton: { backgroundColor: '#0f766e', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  saveButtonDisabled: { backgroundColor: '#9ca3af' },
  saveButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#b00020', fontSize: 13, marginTop: 8 },
  listLoading: { marginTop: 12 },
  emptyText: { color: '#777', fontSize: 14, marginTop: 4 },
  list: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#eee' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  rowSubtitle: { fontSize: 13, color: '#777', marginTop: 2 },
  cancelText: { color: '#b00020', fontSize: 14, fontWeight: '600' },
});
