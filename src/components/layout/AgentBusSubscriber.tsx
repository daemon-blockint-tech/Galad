"use client";

/**
 * Subscribes to the server's agent SSE channel and re-emits actions onto
 * the client-side `dataBus`, so an external tool posting to
 * /api/agent/publish lands on the same event surface the rest of the app
 * already drives off of. Renders nothing — purely a side-effect component,
 * paired with `DataBusSubscriber`.
 *
 * Disabled unless `NEXT_PUBLIC_MAVEN_AGENT_BUS_ENABLED === "true"` so an
 * unintended deployment doesn't open a remote-control channel for users
 * who didn't opt in.
 */

import { useEffect } from "react";
import { dataBus } from "@/core/data/DataBus";
import { pluginManager } from "@/core/plugins/PluginManager";
import { useStore } from "@/core/state/store";
import { getAgentBusEnabled, getBuildAt, getBuildId } from "@/core/grondEnv";
import type { AgentAction } from "@/lib/agent/bus";

function applyAction(msg: AgentAction): void {
    switch (msg.action) {
        case "fly_to":
            dataBus.emit("cameraGoTo", {
                lat: msg.lat,
                lon: msg.lon,
                alt: msg.alt ?? 0,
                distance: msg.distance,
                heading: msg.heading,
            });
            return;
        case "face_towards":
            dataBus.emit("cameraFaceTowards", {
                lat: msg.lat,
                lon: msg.lon,
                alt: msg.alt ?? 0,
            });
            return;
        case "layer_toggle": {
            const managed = pluginManager.getPlugin(msg.pluginId);
            if (!managed) return;
            if (managed.enabled === msg.enabled) return;
            pluginManager.togglePlugin(msg.pluginId);
            return;
        }
        case "highlight_layer":
            dataBus.emit("layerToggled", { pluginId: msg.pluginId, enabled: true });
            return;
        case "select_entity": {
            const entities = pluginManager.getEntities(msg.pluginId);
            const entity = entities.find((e) => e.id === msg.entityId);
            if (entity) dataBus.emit("entitySelected", { entity });
            return;
        }
        case "task_created":
        case "task_updated":
            useStore.getState().upsertOpsTask({
                ...msg.task,
                status: msg.task.status,
            });
            return;
        case "alert_created":
            useStore.getState().upsertOpsAlert({
                id: msg.alert.id,
                severity: msg.alert.severity,
                title: msg.alert.title,
                body: msg.alert.body,
                source: msg.alert.source,
                entityPluginId: msg.alert.entityPluginId,
                entityId: msg.alert.entityId,
                createdAt: msg.alert.createdAt,
            });
            return;
        case "alert_dismissed":
            useStore.getState().removeOpsAlert(msg.alertId);
            return;
        case "authorization_changed":
            fetch("/api/ops/authorization")
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (data) useStore.getState().setOpsAuthorization(data);
                })
                .catch(() => {});
            return;
        case "sim_filter":
            useStore.getState().setOpsSimOnly(msg.enabled);
            return;
        case "ping":
            return;
        default:
            return;
    }
}

export function AgentBusSubscriber() {
    useEffect(() => {
        // Log build-id + agent-bus state once on mount. A stale-bundle / config
        // mismatch becomes visible at a glance in the browser console instead
        // of looking like a feature regression.
        const buildId = getBuildId() ?? "dev";
        const builtAt = getBuildAt() ?? "";
        const agentBusEnabled = getAgentBusEnabled();
        console.log(
            `[grond build] id=${buildId} built_at=${builtAt} agent_bus=${agentBusEnabled ? "on" : "off"}`,
        );

        if (!agentBusEnabled) return;
        if (typeof EventSource === "undefined") return;

        const es = new EventSource("/api/agent/stream", { withCredentials: true });
        es.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data) as AgentAction;
                applyAction(msg);
            } catch (err) {
                console.warn("[AgentBus] malformed message", err);
            }
        };
        es.onerror = (err) => {
            // A CLOSED stream means the server refused it outright — on demo there
            // is no session, so /api/agent/stream 401s and EventSource would
            // otherwise retry for the life of the tab, once per anonymous visitor.
            // A transient drop leaves readyState CONNECTING, which we let it retry.
            if (es.readyState === EventSource.CLOSED) {
                console.debug("[AgentBus] stream closed by the server; not retrying", err);
                es.close();
                return;
            }
            console.debug("[AgentBus] stream error (auto-reconnecting)", err);
        };

        return () => {
            es.close();
        };
    }, []);

    return null;
}
