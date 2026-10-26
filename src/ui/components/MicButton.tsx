import { Pressable, StyleSheet, Text, View } from 'react-native';

import { VoiceState } from '../../voice/voiceSessionMachine';

interface Props {
  state: VoiceState;
  onPress: () => void;
}

// Push-to-talk control.
export default function MicButton({ state, onPress }: Props) {
  const listening = state === 'connected_listening';
  const disabled = state === 'connecting';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={listening ? 'Stop listening' : 'Talk to Nafy'}
        style={[styles.button, listening && styles.buttonListening, disabled && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>{listening ? 'Stop' : 'Talk to Nafy'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  button: { backgroundColor: '#0f766e', borderRadius: 24, paddingVertical: 10, paddingHorizontal: 20 },
  buttonListening: { backgroundColor: '#b91c1c' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
