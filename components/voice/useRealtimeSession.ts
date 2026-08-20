"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { dispatchFunctionCall } from "@/lib/openai/function-calls";
import { toTranscriptLine } from "@/lib/openai/transcript-events";
import { toUsageDelta } from "@/lib/openai/usage-events";
import {
  REALTIME_DATA_CHANNEL,
  isFunctionCallDone,
  parseRealtimeEvent,
} from "@/lib/openai/types";

/**
 * WebRTC で Realtime API と音声を往復させる。
 *
 * 経路（docs/REALTIME_ARCHITECTURE.md §2）:
 *   getUserMedia → RTCPeerConnection → SDP offer
 *     → POST /api/realtime/session（サーバーが OpenAI へ中継）
 *     → SDP answer → 音声再生
 *
 * ブラウザに OpenAI のクレデンシャルは渡らない。
 * データチャネルは開くだけで、function call の処理は Task 6。
 */

export type VoiceStatus =
  | "idle"
  | "requesting-mic"
  | "connecting"
  | "connected"
  | "error";

/** 画面に出す会話履歴の1行 */
export interface TranscriptEntry {
  speaker: "student" | "tutor";
  text: string;
}

export interface UseRealtimeSession {
  status: VoiceStatus;
  error: string | null;
  /** 中央ペインに出す会話履歴 */
  transcript: TranscriptEntry[];
  /** 教材のどこを扱っているか。フェーズが進むと変わる */
  currentPhaseId: string | null;
  /** 授業画面が <audio> に渡す。AI の声はここから鳴る */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  start: () => Promise<void>;
  stop: () => void;
}

/** ICE 候補が出そろうまで待つ。SDP を1回で送りきる方式なので取りこぼせない */
async function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 3000,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    // 待ちすぎると開始が遅く感じるので、時間切れでもそのまま送る
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function messageForStatus(status: number): string {
  switch (status) {
    case 401:
      return "ログインが必要です";
    case 404:
      return "授業セッションが見つかりません。「今日の授業」から開始してください";
    case 429:
      return "接続の回数が多すぎます。時間をおいて試してください";
    case 500:
      // 生徒に環境変数名を見せない。開発者向けの手掛かりはサーバーログにある
      return "サーバー側の設定に問題があります。先生に知らせてください";
    default:
      return "音声サーバーへ接続できませんでした";
  }
}

export function useRealtimeSession(
  lessonSessionId: string | null,
  /** 再読み込み・再接続でも消えないよう、保存済みの履歴から始める */
  initialTranscript: readonly TranscriptEntry[] = [],
  /** アプリ側が持っている現在フェーズ（lesson_sessions.current_phase） */
  initialPhaseId: string | null = null,
): UseRealtimeSession {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    ...initialTranscript,
  ]);
  // 教材のどこを扱っているかの表示に使う。進めてよいかを決めるのはサーバー
  const [currentPhaseId, setCurrentPhaseId] = useState<string | null>(
    initialPhaseId,
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  /** セッション開始時刻。書き起こしの started_at_ms を出すのに使う */
  const startedAtRef = useRef<number>(0);
  /** ブラウザ側の連番。保存する seq はサーバーが採番する */
  const seqRef = useRef<number>(0);

  /** 接続とマイクを解放する。status は変えない（失敗表示を消さないため） */
  const release = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;

    for (const track of micRef.current?.getTracks() ?? []) {
      track.stop();
    }
    micRef.current = null;

    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus("idle");
    setError(null);
  }, [release]);

  // 画面を離れたらマイクを必ず止める
  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (!lessonSessionId) {
      setStatus("error");
      setError("授業セッションがありません。「今日の授業」から開始してください");
      return;
    }

    setError(null);
    setStatus("requesting-mic");

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      startedAtRef.current = Date.now();

      setStatus("connecting");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // AI の音声を受ける
      pc.addEventListener("track", (event) => {
        const [stream] = event.streams;
        if (audioRef.current && stream) {
          audioRef.current.srcObject = stream;
          void audioRef.current.play().catch(() => {
            // 自動再生を拒否されたときはユーザー操作待ち。開始ボタン経由なので通常は起きない
          });
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          setStatus("error");
          setError("接続が切れました");
        }
      });

      for (const track of mic.getTracks()) {
        pc.addTrack(track, mic);
      }

      // tool 呼び出しと書き起こしがここを通る。書き起こしの保存は Task 7
      const channel = pc.createDataChannel(REALTIME_DATA_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent<string>) => {
        const parsed = parseRealtimeEvent(event.data);
        if (!parsed) return;

        if (parsed.type === "error") {
          console.error("[realtime] イベントエラー", parsed);
          return;
        }

        // 利用量。授業単価を出すために記録する
        // （docs/REALTIME_ARCHITECTURE.md §8）
        const usage = toUsageDelta(parsed);
        if (usage) {
          void fetch("/api/results/usage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lessonSessionId, ...usage }),
          }).catch(() => {
            console.warn("[realtime] 利用量の記録に失敗した");
          });
          return;
        }

        const line = toTranscriptLine(parsed);
        if (line) {
          setTranscript((previous) => [...previous, line]);
          // 保存に失敗しても授業は止めない（docs/SECURITY.md の運用方針）
          seqRef.current += 1;
          void fetch("/api/results/transcript", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lessonSessionId,
              items: [
                {
                  seq: seqRef.current,
                  speaker: line.speaker,
                  text: line.text,
                  startedAtMs: Math.max(0, Date.now() - startedAtRef.current),
                },
              ],
            }),
          }).catch(() => {
            console.warn("[realtime] 書き起こしの保存に失敗した");
          });
          return;
        }

        if (isFunctionCallDone(parsed)) {
          // 記録専用。サーバーが所有者と item_id を検証する
          void dispatchFunctionCall({
            event: parsed,
            lessonSessionId,
            send: (payload) => {
              if (channel.readyState === "open") channel.send(payload);
            },
          }).then((output) => {
            // フェーズが進んだら教材のハイライト位置も動かす
            if (typeof output.next_phase === "string") {
              setCurrentPhaseId(output.next_phase);
            }
          });
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      const localSdp = pc.localDescription?.sdp ?? offer.sdp;
      if (!localSdp) throw new Error("SDP を作成できなかった");

      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonSessionId, sdp: localSdp }),
      });

      if (!response.ok) {
        release();
        setStatus("error");
        setError(messageForStatus(response.status));
        return;
      }

      const answer = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setStatus("connected");
    } catch (cause) {
      release();
      setStatus("error");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "マイクの使用が許可されませんでした"
          : "音声を開始できませんでした",
      );
    }
  }, [lessonSessionId, release]);

  return { status, error, transcript, currentPhaseId, audioRef, start, stop };
}
