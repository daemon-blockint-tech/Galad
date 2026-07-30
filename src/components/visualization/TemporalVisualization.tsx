'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, FastForward, Volume2, AlertCircle } from 'lucide-react';
import { TemporalPlayback, TemporalSnapshot } from '@/core/temporal/TemporalPlayback';

interface TemporalVisualizationProps {
  playback: TemporalPlayback;
  onSnapshotChange?: (snapshot: TemporalSnapshot | null) => void;
  onEventJump?: (eventType: 'anomaly' | 'alert') => void;
  height?: string;
}

export function TemporalVisualization({
  playback,
  onSnapshotChange,
  onEventJump,
  height = 'h-64',
}: TemporalVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [metadata, setMetadata] = useState(playback.getMetadata());
  const [snapshot, setSnapshot] = useState<TemporalSnapshot | null>(playback.getSnapshot());
  const animationRef = useRef<number | undefined>(undefined);

  // Update display every frame when playing
  useEffect(() => {
    const updateDisplay = () => {
      const snap = playback.getSnapshot();
      setSnapshot(snap);
      setMetadata(playback.getMetadata());
      onSnapshotChange?.(snap);

      if (isPlaying) {
        animationRef.current = requestAnimationFrame(updateDisplay);
      }
    };

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateDisplay);
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [isPlaying, playback, onSnapshotChange]);

  const handlePlayPause = () => {
    if (isPlaying) {
      playback.pause();
      setIsPlaying(false);
    } else {
      playback.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    playback.stop();
    setIsPlaying(false);
    setSnapshot(playback.getSnapshot());
    setMetadata(playback.getMetadata());
  };

  const handleNextFrame = () => {
    playback.pause();
    const snap = playback.nextFrame();
    setSnapshot(snap);
    setMetadata(playback.getMetadata());
    setIsPlaying(false);
    onSnapshotChange?.(snap);
  };

  const handlePreviousFrame = () => {
    playback.pause();
    const snap = playback.previousFrame();
    setSnapshot(snap);
    setMetadata(playback.getMetadata());
    setIsPlaying(false);
    onSnapshotChange?.(snap);
  };

  const handleSpeedChange = (newSpeed: number) => {
    playback.setSpeed(newSpeed);
    setSpeed(newSpeed);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const progress = parseFloat(e.target.value);
    const targetIndex = Math.floor((progress / 100) * (metadata.totalFrames - 1));
    const targetTimestamp = metadata.startTimestamp + ((targetIndex / (metadata.totalFrames - 1)) * (metadata.endTimestamp - metadata.startTimestamp));
    playback.seek(targetTimestamp);
    playback.pause();
    setIsPlaying(false);

    const snap = playback.getSnapshot();
    setSnapshot(snap);
    setMetadata(playback.getMetadata());
    onSnapshotChange?.(snap);
  };

  const handleJumpToAnomaly = () => {
    const found = playback.jumpToAnomaly('forward');
    if (found) {
      const snap = playback.getSnapshot();
      setSnapshot(snap);
      setMetadata(playback.getMetadata());
      onSnapshotChange?.(snap);
      onEventJump?.('anomaly');
    }
  };

  const handleJumpToAlert = () => {
    const found = playback.jumpToAlert('forward');
    if (found) {
      const snap = playback.getSnapshot();
      setSnapshot(snap);
      setMetadata(playback.getMetadata());
      onSnapshotChange?.(snap);
      onEventJump?.('alert');
    }
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div ref={containerRef} className={`${height} bg-slate-950 rounded-lg border border-slate-800 p-4 flex flex-col gap-4`}>
      {/* Timeline scrubber */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-xs text-slate-400 font-mono">
          <span>{formatTime(metadata.currentTimestamp || metadata.startTimestamp)}</span>
          <span>
            Frame {metadata.currentFrame + 1} / {metadata.totalFrames}
          </span>
          <span>{formatTime(metadata.endTimestamp)}</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          value={metadata.totalFrames > 0 ? playback.getProgress() : 0}
          onChange={handleSeek}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
          disabled={metadata.totalFrames === 0}
        />

        <div className="flex justify-between text-xs text-slate-500">
          <span>Duration: {formatDuration(metadata.endTimestamp - metadata.startTimestamp)}</span>
          <span>Speed: {speed.toFixed(1)}x</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Playback buttons */}
        <button
          onClick={handleStop}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
          title="Stop and reset"
        >
          <SkipBack size={18} />
        </button>

        <button
          onClick={handlePreviousFrame}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
          title="Previous frame"
        >
          <SkipBack size={18} />
        </button>

        <button
          onClick={handlePlayPause}
          className={`p-2 rounded transition ${
            isPlaying ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-800 hover:bg-slate-700'
          } text-white`}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          onClick={handleNextFrame}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
          title="Next frame"
        >
          <SkipForward size={18} />
        </button>

        {/* Speed control */}
        <div className="flex items-center gap-1 ml-4">
          <Volume2 size={16} className="text-slate-400" />
          <select
            value={speed}
            onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
            className="bg-slate-800 text-slate-300 text-sm rounded px-2 py-1 border border-slate-700"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </div>

        {/* Event jump buttons */}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleJumpToAnomaly}
            className="p-2 bg-yellow-900/30 hover:bg-yellow-900/50 text-yellow-400 rounded transition border border-yellow-900"
            title="Jump to next anomaly"
          >
            <AlertCircle size={18} />
          </button>

          <button
            onClick={handleJumpToAlert}
            className="p-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded transition border border-red-900"
            title="Jump to next alert"
          >
            <AlertCircle size={18} />
          </button>
        </div>
      </div>

      {/* Event display */}
      {snapshot && snapshot.events.length > 0 && (
        <div className="text-xs text-slate-400 space-y-1 max-h-20 overflow-y-auto">
          <div className="font-semibold text-slate-300">Events ({snapshot.events.length})</div>
          {snapshot.events.slice(0, 3).map((event, i) => (
            <div key={i} className="flex items-center gap-2">
              {event.type === 'anomaly' && <span className="w-2 h-2 bg-yellow-500 rounded-full" />}
              {event.type === 'alert' && <span className="w-2 h-2 bg-red-500 rounded-full" />}
              <span>{event.description}</span>
            </div>
          ))}
          {snapshot.events.length > 3 && (
            <div className="text-slate-500">+{snapshot.events.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}
