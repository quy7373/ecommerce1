import { useState, type FormEvent } from 'react';
import { Send, Bot, User as UserIcon, AlertTriangle, Sparkles } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ApiError } from '@/lib/apiClient';
import { sendSupportMessage } from '@/features/chatbot/supportApi';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  escalated?: boolean;
}

const SUGGESTED_QUESTIONS = [
  'What is the shipping policy?',
  'How do returns and refunds work?',
  'Which payment methods are supported?',
  'How do I cancel a pending order?',
];

export function SupportCenterPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submitQuestion = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || trimmed.length > 2000 || sending) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const response = await sendSupportMessage(trimmed);
      const assistantMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'assistant',
        text: response.answer,
        escalated: response.escalated,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({
              status: 0,
              code: 'UNKNOWN_ERROR',
              message: 'Unable to reach AI Support right now.',
            })
      );
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitQuestion(input);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="rounded-3xl border border-[#E6E4DD] bg-white bg-hero-grid p-6 sm:p-8 shadow-[0_2px_10px_rgba(17,21,28,0.04)]">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#D4E3F1] bg-[#EDF4FA] px-3 py-1 text-xs font-semibold text-[#0F4C81]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Grounded Store Assistant</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold text-[#11151C] sm:text-3xl">AI Support Center</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[#555E6D] leading-relaxed">
          Ask about shipping, returns, payments, or ordering. Responses cite approved store
          documentation and escalate when no approved source confirms an answer.
        </p>
      </div>

      {error && (
        <Alert
          tone="error"
          title={
            error.code === 'RATE_LIMITED'
              ? 'Too many support requests'
              : error.code === 'AI_UNAVAILABLE'
              ? 'AI Support temporarily unavailable'
              : 'Support request failed'
          }
          requestId={error.requestId}
        >
          {error.message}
          {error.retryAfterSeconds ? ` Wait ${error.retryAfterSeconds}s before retrying.` : ''}
        </Alert>
      )}

      <Card className="flex flex-col overflow-hidden">
        <div
          aria-live="polite"
          aria-label="Support conversation"
          className="min-h-88 max-h-[56vh] overflow-y-auto p-6 space-y-4 bg-[#FAF9F6]"
        >
          {messages.length === 0 ? (
            <div className="py-10 text-center space-y-5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#11151C] text-white shadow-sm">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-[#11151C]">Ask a policy question</h2>
                <p className="text-xs text-[#555E6D]">
                  Questions are answered independently; chat transcripts are not stored.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={sending}
                    onClick={() => void submitQuestion(q)}
                    className="rounded-full border border-[#D8D5CC] bg-white px-4 py-2 text-xs font-medium text-[#11151C] shadow-2xs transition-all hover:border-[#0F4C81] hover:bg-[#EDF4FA]/60 hover:text-[#0F4C81] cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${
                  msg.sender === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.sender === 'assistant' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#0F4C81] text-white shadow-2xs">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-2xs ${
                    msg.sender === 'user'
                      ? 'bg-[#11151C] text-white rounded-tr-sm'
                      : 'border border-[#E6E4DD] bg-white text-[#11151C] rounded-tl-sm'
                  }`}
                >
                  <p className="whitespace-pre-line">{msg.text}</p>

                  {msg.sender === 'assistant' && msg.escalated && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#F2D8AE] bg-[#FDF6EC] px-3 py-2 text-xs font-medium text-[#7A460E]">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-[#9A5B13]" aria-hidden="true" />
                      <span>Escalated to human store support (no approved source confirmed).</span>
                    </div>
                  )}
                </div>

                {msg.sender === 'user' && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#EFEDE7] text-[#11151C] border border-[#E6E4DD]">
                    <UserIcon className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[#E6E4DD] bg-white p-4 space-y-2">
          <label htmlFor="support-message-input" className="sr-only">
            Ask a support question
          </label>
          <div className="flex gap-2">
            <input
              id="support-message-input"
              type="text"
              maxLength={2000}
              disabled={sending}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about shipping, returns, payments, or ordering..."
              className="flex-1 rounded-xl border border-[#D8D5CC] bg-[#FAF9F6] px-4 py-2.5 text-sm text-[#11151C] placeholder:text-[#8C96A2] transition-all focus:border-[#0F4C81] focus:bg-white focus:ring-3 focus:ring-[#0F4C81]/15 disabled:bg-[#EFEDE7]"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={sending}
              disabled={!input.trim()}
              className="rounded-xl px-5"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>Send</span>
            </Button>
          </div>
          <div className="flex justify-between text-xs text-[#6B7684] tabular-nums">
            <span>Do not include card numbers or sensitive personal data.</span>
            <span>{input.length} / 2000</span>
          </div>
        </form>
      </Card>
    </div>
  );
}
