"use client";

import { useState } from "react";
import type { PluginManifest } from "@/core/plugins/PluginManifest";
import styles from "./UnverifiedPluginBatchDialog.module.css";

interface Props {
  manifests: PluginManifest[];
  onApproveSelected: (ids: string[]) => void;
  onDenyAll: () => void;
}

/** Where a bundle actually loads from, shown next to the name so consent is informed. */
function describeEntry(entry: string | undefined): string {
  if (!entry) return "unknown source";
  try {
    const url = new URL(entry, "https://app.invalid/");
    return url.origin === "https://app.invalid" ? url.pathname : `${url.host}${url.pathname}`;
  } catch {
    return entry;
  }
}

export default function UnverifiedPluginBatchDialog({
  manifests,
  onApproveSelected,
  onDenyAll,
}: Props) {
  // Nothing is pre-ticked: approving is what allows a bundle to run, so it has to
  // be a deliberate choice per plugin. Defaulting to all meant a plugin that
  // arrived alongside a recognised one was approved by the same click.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleInstall() {
    setLoading(true);
    onApproveSelected([...selected]);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.icon}>⚠️</div>
          <h3 className={styles.title}>Unverified Plugins</h3>
          <p className={styles.subtitle}>
            {manifests.length}
            {' '}
            plugin
            {manifests.length > 1 ? "s" : ""}
            {' '}
            not
            verified by Grond. Select which to install.
          </p>
        </div>

        <ul className={styles.list}>
          {manifests.map((m) => (
            <li
              key={m.id}
              className={styles.item}
              onClick={() => toggle(m.id)}
            >
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={selected.has(m.id)}
                onChange={() => toggle(m.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className={styles.pluginName}>
                {m.name ?? m.id}
                {/* Approval is recorded against (id, version, entry), so the
                    version and the code's origin have to be visible — otherwise
                    the user is consenting to fields they were never shown. */}
                <span className={styles.pluginSource}>
                  {m.version ? `v${m.version} · ` : ""}
                  {describeEntry(m.entry)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className={styles.risk}>
          Unverified plugins run in your browser and could access your
          session data. Proceed at your own risk.
        </p>

        <div className={styles.actions}>
          <button className={styles.denyBtn} onClick={onDenyAll}>
            Deny All
          </button>
          <button
            className={styles.allowBtn}
            onClick={handleInstall}
            disabled={loading || selected.size === 0}
          >
            {loading
              ? "Installing…"
              : `Install Selected (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
