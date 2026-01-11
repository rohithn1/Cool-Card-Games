'use client';

import { useState, useEffect, useRef } from 'react';
import { Lobby } from '@/components/Lobby';
import { GameTable } from '@/components/GameTable';
import { useGameStore } from '@/store/gameStore';
import { getMultiplayerConnection } from '@/lib/multiplayer';
import { GameMessage, GameState } from '@/types/game';

export default function Home() {
  const [gameStarted, setGameStarted] = useState(false);
  const { game, peerId, isHost, syncState } = useGameStore();
  const lastBroadcastRef = useRef<string>('');
  const lastSyncTimestampRef = useRef<number>(0);
  const suppressNextBroadcastRef = useRef<boolean>(false);

  // Set up game state sync for all players
  useEffect(() => {
    if (!peerId) return;

    const mp = getMultiplayerConnection();
    
    const unsubscribe = mp.onMessage((message: GameMessage) => {
      if (message.type === 'state_sync' && message.payload) {
        // Only sync if the message is from someone else
        if (message.senderId !== peerId) {
          // Use timestamp to resolve conflicts - newer state wins
          if (message.timestamp > lastSyncTimestampRef.current) {
            lastSyncTimestampRef.current = message.timestamp;
            console.log('📥 Receiving state sync:', (message.payload as GameState).lastAction);
            // Prevent echo-loop: applying remote state should not trigger a broadcast
            suppressNextBroadcastRef.current = true;
            syncState(message.payload as GameState);
          }
        }
      }
      
      // Host handles player_ready messages
      if (message.type === 'player_ready' && isHost && message.payload) {
        const { playerId } = message.payload as { playerId: string };
        const currentGame = useGameStore.getState().game;
        if (currentGame) {
          const updatedPlayers = currentGame.players.map(p => {
            if (p.id === playerId) {
              return { ...p, hasSeenBottomCards: true };
            }
            return p;
          });
          
          const allReady = updatedPlayers.every(p => p.hasSeenBottomCards);
          
          const newGameState = {
            ...currentGame,
            players: updatedPlayers,
            phase: allReady ? 'playing' as const : 'viewing_cards' as const,
            lastAction: allReady 
              ? 'All players ready! Host draws first.' 
              : `Waiting for ${updatedPlayers.filter(p => !p.hasSeenBottomCards).length} player(s) to be ready...`,
          };
          
          syncState(newGameState);
          mp.broadcastState(newGameState);
        }
      }
    });

    return () => { unsubscribe(); };
  }, [peerId, isHost, syncState]);

  // Broadcast state changes - trigger on ANY game state change by the local player
  useEffect(() => {
    if (!game || !gameStarted || !peerId) return;

    // Create a hash of the game state to detect real changes
    // stateVersion should be incremented on every state change
    const stateHash = JSON.stringify({
      stateVersion: game.stateVersion || 0,
    });

    // Only broadcast if state actually changed
    if (stateHash === lastBroadcastRef.current) return;
    lastBroadcastRef.current = stateHash;

    // If this change came from remote sync, don't rebroadcast it
    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      console.log('🛑 Suppressing broadcast (remote state sync applied)');
      return;
    }

    const mp = getMultiplayerConnection();
    
    // ALWAYS broadcast local state changes
    console.log('📤 Broadcasting state change:', game.lastAction, 'version:', game.stateVersion);
    mp.broadcastState(game);
  }, [game, gameStarted, peerId]);

  const handleGameStart = () => {
    setGameStarted(true);
  };

  if (gameStarted && game && game.phase !== 'waiting') {
    return <GameTable />;
  }

  return <Lobby onGameStart={handleGameStart} />;
}
