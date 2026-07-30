'use client';

import React, { useState, useEffect } from 'react';
import {
  MapPin,
  AlertTriangle,
  Plane,
  Anchor,
  Crosshair,
  Zap,
  Play,
  Pause,
  RotateCcw,
  Layers,
  Eye,
  EyeOff,
  TrendingUp,
} from 'lucide-react';

interface GeoLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp: number;
}

interface EntityTrack {
  entityId: string;
  entityName: string;
  platformType: 'air' | 'land' | 'sea' | 'space';
  currentLocation: GeoLocation;
  trackHistory: GeoLocation[];
  status: 'online' | 'offline' | 'degraded';
  threatLevel: number;
  heading?: number;
  speed?: number;
}

interface MapLayer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  opacity: number;
}

interface TacticalMapVisualizationProps {
  tracks?: EntityTrack[];
  layers?: MapLayer[];
  isPlayingback?: boolean;
  onTrackSelect?: (trackId: string) => void;
  onPlaybackToggle?: (isPlaying: boolean) => void;
}

export function TacticalMapVisualization({
  tracks = [],
  layers = [],
  isPlayingback = false,
  onTrackSelect,
  onPlaybackToggle,
}: TacticalMapVisualizationProps) {
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(isPlayingback);
  const [playbackTime, setPlaybackTime] = useState(Date.now());
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(
    layers.reduce((acc, l) => ({ ...acc, [l.id]: l.visible }), {}),
  );
  const [mapCenter, setMapCenter] = useState({ lat: 35.6762, lon: 139.6503 }); // Tokyo default
  const [zoomLevel, setZoomLevel] = useState(6);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setPlaybackTime((t) => t + 1000 * playbackSpeed);
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  const handlePlayToggle = () => {
    const newState = !isPlaying;
    setIsPlaying(newState);
    onPlaybackToggle?.(newState);
  };

  const handleLayerToggle = (layerId: string) => {
    setVisibleLayers((prev) => ({
      ...prev,
      [layerId]: !prev[layerId],
    }));
  };

  const getPlatformIcon = (type: 'air' | 'land' | 'sea' | 'space') => {
    switch (type) {
      case 'air':
        return <Plane size={16} />;
      case 'sea':
        return <Anchor size={16} />;
      case 'land':
        return <Crosshair size={16} />;
      case 'space':
        return <Zap size={16} />;
    }
  };

  const getThreatColor = (threatLevel: number) => {
    if (threatLevel > 80) return 'text-red-500 bg-red-900/30';
    if (threatLevel > 60) return 'text-orange-500 bg-orange-900/30';
    if (threatLevel > 40) return 'text-yellow-500 bg-yellow-900/30';
    return 'text-green-500 bg-green-900/30';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online':
        return 'text-green-400';
      case 'degraded':
        return 'text-yellow-400';
      case 'offline':
        return 'text-red-400';
      default:
        return 'text-slate-400';
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Tactical Map Canvas */}
      <div className="flex-1 bg-slate-900 border border-slate-700 rounded overflow-hidden relative">
        {/* Map Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          {/* Grid */}
          <svg className="absolute inset-0 w-full h-full opacity-10">
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="slate-400" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Threat Heatmap (if enabled) */}
          {visibleLayers['threat_heatmap'] && (
            <div className="absolute inset-0 bg-gradient-to-r from-red-900/20 via-orange-900/10 to-transparent opacity-40" />
          )}

          {/* Entity Tracks */}
          <div className="absolute inset-0">
            {tracks.map((track) => {
              const posX = ((track.currentLocation.longitude - (-180)) / 360) * 100;
              const posY = ((90 - track.currentLocation.latitude) / 180) * 100;

              return (
                <div
                  key={track.entityId}
                  className="absolute cursor-pointer group"
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={() => {
                    setSelectedTrack(track.entityId);
                    onTrackSelect?.(track.entityId);
                  }}
                >
                  {/* Track History Path */}
                  {track.trackHistory.length > 1 && (
                    <svg
                      className="absolute w-32 h-32 opacity-50"
                      style={{ left: '-64px', top: '-64px' }}
                    >
                      <polyline
                        points={track.trackHistory.map((loc) => {
                          const x = ((loc.longitude - (-180)) / 360) * 128;
                          const y = ((90 - loc.latitude) / 180) * 128;
                          return `${x},${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke={`${getThreatColor(track.threatLevel).split(' ')[0]}`}
                        strokeWidth="1"
                        opacity="0.6"
                      />
                    </svg>
                  )}

                  {/* Entity Marker */}
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-all ${
                      selectedTrack === track.entityId ? 'ring-4 ring-cyan-400 scale-125' : ''
                    } ${getThreatColor(track.threatLevel)}`}
                  >
                    {getPlatformIcon(track.platformType)}
                  </div>

                  {/* Status Indicator */}
                  <div
                    className={`absolute w-3 h-3 rounded-full top-0 right-0 ${getStatusColor(track.status)}`}
                  />

                  {/* Hover Label */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    {track.entityName}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Map Controls */}
        <div className="absolute top-4 left-4 space-y-2">
          <div className="bg-slate-800/90 border border-slate-700 rounded p-2 space-y-1">
            <button
              onClick={() => setZoomLevel(Math.min(zoomLevel + 1, 12))}
              className="w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-slate-100 text-sm"
            >
              +
            </button>
            <button
              onClick={() => setZoomLevel(Math.max(zoomLevel - 1, 1))}
              className="w-8 h-8 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-slate-100 text-sm"
            >
              −
            </button>
          </div>
        </div>

        {/* Layer Toggle */}
        <div className="absolute bottom-4 right-4 bg-slate-800/90 border border-slate-700 rounded p-3 space-y-2 max-w-xs">
          <p className="text-xs font-semibold text-slate-300">Map Layers</p>
          {layers.map((layer) => (
            <label key={layer.id} className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={visibleLayers[layer.id] ?? layer.visible}
                onChange={() => handleLayerToggle(layer.id)}
                className="rounded"
              />
              <span className="text-slate-300">{layer.name}</span>
              <div className="w-4 h-4 rounded bg-slate-700" style={{ opacity: layer.opacity }} />
            </label>
          ))}
        </div>

        {/* Track Info Panel */}
        {selectedTrack && tracks.find((t) => t.entityId === selectedTrack) && (
          <div className="absolute bottom-4 left-4 bg-slate-800/95 border border-slate-700 rounded p-3 max-w-xs">
            {(() => {
              const track = tracks.find((t) => t.entityId === selectedTrack)!;
              return (
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="font-semibold text-slate-100">{track.entityName}</p>
                    <p className="text-slate-400">{track.entityId}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-slate-500">Status</p>
                      <p className={getStatusColor(track.status)}>
                        {track.status.toUpperCase()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Threat Level</p>
                      <p className={getThreatColor(track.threatLevel).split(' ')[0]}>
                        {track.threatLevel.toFixed(0)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Lat/Lon</p>
                      <p className="text-slate-300">
                        {track.currentLocation.latitude.toFixed(3)}, {track.currentLocation.longitude.toFixed(3)}
                      </p>
                    </div>
                    {track.speed && (
                      <div>
                        <p className="text-slate-500">Speed</p>
                        <p className="text-slate-300">{track.speed} knots</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Playback Controls */}
      <div className="bg-slate-800/50 border border-slate-700 rounded p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">Temporal Playback</span>
          <span className="text-xs text-slate-500">{formatTime(playbackTime)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePlayToggle}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition"
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <button
            onClick={() => setPlaybackTime(Date.now())}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-300 transition"
          >
            <RotateCcw size={16} />
          </button>

          <input
            type="range"
            min="0.5"
            max="4"
            step="0.5"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            className="flex-1 h-2 bg-slate-700 rounded"
          />
          <span className="text-xs text-slate-400 min-w-fit">{playbackSpeed.toFixed(1)}x</span>
        </div>

        <input
          type="range"
          min={Date.now() - 3600000}
          max={Date.now()}
          value={playbackTime}
          onChange={(e) => setPlaybackTime(parseInt(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded"
        />

        <div className="flex justify-between text-xs text-slate-500">
          <span>{formatTime(Date.now() - 3600000)}</span>
          <span>{formatTime(Date.now())}</span>
        </div>
      </div>

      {/* Statistics Panel */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-slate-800/30 border border-slate-700 rounded p-2">
          <p className="text-xs text-slate-500">Total Tracks</p>
          <p className="text-sm font-semibold text-slate-100">{tracks.length}</p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded p-2">
          <p className="text-xs text-slate-500">Critical Threats</p>
          <p className="text-sm font-semibold text-red-400">
            {tracks.filter((t) => t.threatLevel > 80).length}
          </p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded p-2">
          <p className="text-xs text-slate-500">Online Assets</p>
          <p className="text-sm font-semibold text-green-400">
            {tracks.filter((t) => t.status === 'online').length}
          </p>
        </div>
        <div className="bg-slate-800/30 border border-slate-700 rounded p-2">
          <p className="text-xs text-slate-500">Avg Threat</p>
          <p className="text-sm font-semibold text-slate-100">
            {(tracks.reduce((sum, t) => sum + t.threatLevel, 0) / Math.max(tracks.length, 1)).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
