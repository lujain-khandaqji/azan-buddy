import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CoachingMessage, useCoaching } from '../hooks/useCoaching';

function MessageBubble({ message }: { message: CoachingMessage }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowNafy]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleNafy]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser]}>{message.text}</Text>
      </View>
    </View>
  );
}

export default function CoachingScreen() {
  const { messages, sending, error, sendMessage } = useCoaching();
  const [inputText, setInputText] = useState('');
  const listRef = useRef<FlatList<CoachingMessage>>(null);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  async function handleSend() {
    const question = inputText;
    if (!question.trim() || sending) return;
    setInputText('');
    await sendMessage(question);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Coaching</Text>
        <Text style={styles.subtitle}>Ask Nafy about your prayers</Text>
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="never"
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListEmptyComponent={<Text style={styles.emptyText}>Ask a question to get started.</Text>}
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      <View style={styles.inputRow}>
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask Nafy a question…"
          style={styles.input}
          editable={!sending}
          multiline
        />
        <Pressable
          onPress={handleSend}
          disabled={!inputText.trim() || sending}
          style={[styles.sendButton, (!inputText.trim() || sending) && styles.sendButtonDisabled]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#777', marginTop: 2 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingVertical: 12, flexGrow: 1 },
  emptyText: { color: '#777', fontSize: 14, textAlign: 'center', marginTop: 24 },
  bubbleRow: { flexDirection: 'row', marginVertical: 6 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowNafy: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleUser: { backgroundColor: '#0f766e', borderBottomRightRadius: 4 },
  bubbleNafy: { backgroundColor: '#f0fdfa', borderWidth: 1, borderColor: '#ccfbf1', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, color: '#134e4a', lineHeight: 20 },
  bubbleTextUser: { color: '#ffffff' },
  errorText: { color: '#b00020', fontSize: 13, paddingHorizontal: 20, paddingBottom: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#1a1a1a',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#0f766e',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#9ca3af' },
  sendButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
