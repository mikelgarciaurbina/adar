// Start screen shown when no repository tab is open.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CornerDownLeft,
  Download,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Layers,
  Search,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { api, isElectron } from "@renderer/api/client";
import * as git from "@renderer/actions/git";
import { openGroup, renameGroup } from "@renderer/actions/groups";
import { Button, Kbd } from "@renderer/components/common/Button";
import { showContextMenu } from "@renderer/components/common/ContextMenu";
import { toast } from "@renderer/components/common/toast";
import { getCommand } from "@renderer/commands";
import { relativeTime } from "@renderer/lib/format";
import { shortcutLabel } from "@renderer/lib/keys";
import { useApp } from "@renderer/store/appStore";
import { summarizeList } from "@renderer/lib/format";
import { folderName } from "@renderer/lib/tabGroups";
import type { Identity, RecentRepo, TabGroup } from "@shared/types";
import {
  distinctParents,
  formatGitVersion,
  tildify,
  toUnixSeconds,
} from "./chrome";
import { useNow } from "./hooks";
import { AdarAntlerLines, AdarLogo } from "./Logo";
import "./layout.css";

function shortcutOf(id: string): string | null {
  const spec = getCommand(id)?.shortcut;
  return spec ? shortcutLabel(spec) : null;
}

const FILTER_THRESHOLD = 6;

export function Welcome() {
  const recent = useApp((s) => s.recent);
  const groups = useApp((s) => s.settings.tabGroups);
  const appInfo = useApp((s) => s.appInfo);
  const openModal = useApp((s) => s.openModal);
  const modal = useApp((s) => s.modal);
  const now = useNow(60_000);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [filter, setFilter] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global identity check (re-run after the identity/settings modal closes).
  useEffect(() => {
    if (modal) return;
    let alive = true;
    api.getIdentity(null).then(
      (id) => alive && setIdentity(id),
      () => alive && setIdentity(null),
    );
    return () => {
      alive = false;
    };
  }, [modal]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...recent].sort((a, b) => b.lastOpened - a.lastOpened);
    if (!q) return sorted;
    return sorted.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
    );
  }, [recent, filter]);

  const hints = useMemo(() => distinctParents(recent), [recent]);

  const open = async (path: string) => {
    if (opening) return;
    setOpening(path);
    try {
      await git.openRepoAt(path);
    } finally {
      setOpening(null);
    }
  };

  const remove = async (r: RecentRepo) => {
    try {
      await api.removeRecentRepo(r.path);
      await useApp.getState().refreshRecent();
    } catch (err) {
      toast.error(err);
    }
  };

  const gitVersion = formatGitVersion(appInfo?.gitVersion);
  const gitMissing =
    !!appInfo &&
    (appInfo.gitVersion === "" ||
      /not (found|installed)/i.test(appInfo.gitVersion));
  const identityMissing =
    !!identity &&
    (identity.scope === "none" ||
      !identity.name.trim() ||
      !identity.email.trim());

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>(".wl-recent-item") ?? [],
    );
    if (!items.length) return;
    e.preventDefault();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? Math.min(items.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    items[idx < 0 ? 0 : next]?.focus();
  };

  return (
    <div className="wl-root">
      {/* The antlers, drawn as faint lanes behind the screen: the one place the story shows in the app. */}
      <div className="wl-backdrop" aria-hidden="true">
        <AdarAntlerLines className="wl-antler" />
      </div>
      <div className="wl-scroll">
        <div className="wl-content">
          <div className="wl-intro">
            <header className="wl-hero">
              <AdarLogo bare size={44} className="wl-logo" />
              <h1 className="wl-title" lang="eu">
                adar
              </h1>
              <p className="wl-definition">
                <span className="wl-definition-kind">Basque · noun</span>
                <span>
                  <b>1</b> branch of a tree
                </span>
                <span>
                  <b>2</b> antler
                </span>
              </p>
              <p className="wl-tagline">
                A Git client that draws every repository your git can reach,
                branch by branch.
              </p>
            </header>

            {gitMissing && (
              <div className="wl-card wl-warning" role="alert">
                <TriangleAlert size={18} />
                <div className="wl-warning-body">
                  <strong>Git was not found on this system.</strong>
                  <span>
                    Adar uses your installed git. Install it (e.g. Xcode Command
                    Line Tools: xcode-select --install) and restart.
                  </span>
                </div>
              </div>
            )}

            <div className="wl-actions">
              <button
                className="wl-action wl-action-primary"
                onClick={() => void git.openRepoDialog()}
              >
                <span className="wl-action-icon">
                  <FolderOpen size={18} />
                </span>
                <span className="wl-action-text">
                  <span className="wl-action-title">Open a repository</span>
                  <span className="wl-action-desc">
                    Browse to any local Git repository
                  </span>
                </span>
                {shortcutOf("open-repo") && (
                  <Kbd>{shortcutOf("open-repo")}</Kbd>
                )}
              </button>
              <button
                className="wl-action"
                onClick={() => openModal({ kind: "clone" })}
              >
                <span className="wl-action-icon">
                  <Download size={18} />
                </span>
                <span className="wl-action-text">
                  <span className="wl-action-title">Clone a repository</span>
                  <span className="wl-action-desc">
                    HTTPS or SSH, public or private
                  </span>
                </span>
                {shortcutOf("clone-repo") && (
                  <Kbd>{shortcutOf("clone-repo")}</Kbd>
                )}
              </button>
              <button
                className="wl-action"
                onClick={() => openModal({ kind: "init" })}
              >
                <span className="wl-action-icon">
                  <FolderPlus size={18} />
                </span>
                <span className="wl-action-text">
                  <span className="wl-action-title">
                    Start a local repository
                  </span>
                  <span className="wl-action-desc">
                    Create a new repo with git init
                  </span>
                </span>
                {shortcutOf("init-repo") && (
                  <Kbd>{shortcutOf("init-repo")}</Kbd>
                )}
              </button>
            </div>

            {!isElectron && (
              <form
                className="wl-card wl-path-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = pathInput.trim();
                  if (p) void open(p);
                }}
              >
                <label className="wl-path-label" htmlFor="wl-path">
                  Open by path
                </label>
                <input
                  id="wl-path"
                  className="ui-input ui-mono"
                  placeholder="/absolute/path/to/repository"
                  value={pathInput}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setPathInput(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!pathInput.trim()}
                  loading={!!opening && opening === pathInput.trim()}
                  icon={<CornerDownLeft size={14} />}
                >
                  Open
                </Button>
              </form>
            )}

            {identityMissing && (
              <div className="wl-card wl-warning">
                <UserRound size={18} />
                <div className="wl-warning-body">
                  <strong>Your Git identity is not set</strong>
                  <span>
                    Commits need a name and email. Set a global identity used by
                    all repositories.
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => openModal({ kind: "identity", repo: null })}
                >
                  Set identity…
                </Button>
              </div>
            )}
          </div>

          <div className="wl-lists">
            {groups.length > 0 && (
              <GroupList groups={groups} homeDir={appInfo?.homeDir ?? null} />
            )}

            <section className="wl-card wl-recent">
              <div className="wl-recent-head">
                <h2 className="wl-section-title">Recent repositories</h2>
                {recent.length > FILTER_THRESHOLD && (
                  <div className="wl-filter">
                    <Search size={12} />
                    <input
                      className="wl-filter-input"
                      placeholder="Filter…"
                      value={filter}
                      spellCheck={false}
                      onChange={(e) => setFilter(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          listRef.current
                            ?.querySelector<HTMLElement>(".wl-recent-item")
                            ?.focus();
                        } else if (e.key === "Escape" && filter) {
                          e.stopPropagation();
                          setFilter("");
                        }
                      }}
                      aria-label="Filter recent repositories"
                    />
                  </div>
                )}
              </div>
              {recent.length === 0 ? (
                <div className="wl-recent-empty">
                  <FolderGit2 size={20} />
                  <span>Repositories you open or clone will appear here.</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="wl-recent-empty">
                  No repositories match “{filter}”.
                </div>
              ) : (
                <div
                  className="wl-recent-list"
                  ref={listRef}
                  onKeyDown={onListKeyDown}
                >
                  {filtered.map((r) => (
                    <div
                      key={r.path}
                      className={`wl-recent-item${opening === r.path ? " wl-opening" : ""}`}
                      role="button"
                      tabIndex={0}
                      title={r.path}
                      onClick={() => void open(r.path)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void open(r.path);
                        } else if (
                          e.key === "Delete" ||
                          e.key === "Backspace"
                        ) {
                          e.preventDefault();
                          void remove(r);
                        }
                      }}
                      onContextMenu={(e) =>
                        showContextMenu(e, [
                          { label: "Open", onClick: () => open(r.path) },
                          {
                            label: "Copy Path",
                            onClick: () => git.copyText(r.path, "Path copied"),
                          },
                          {
                            label: "Remove from List",
                            danger: true,
                            onClick: () => remove(r),
                          },
                        ])
                      }
                    >
                      <span className="wl-recent-icon">
                        {opening === r.path ? (
                          <span className="ui-spinner ui-spinner-sm" />
                        ) : (
                          <FolderGit2 size={16} />
                        )}
                      </span>
                      <span className="wl-recent-text">
                        <span className="wl-recent-name">
                          {r.name}
                          {hints.has(r.path) && (
                            <span className="wl-recent-hint">
                              {hints.get(r.path)}
                            </span>
                          )}
                        </span>
                        {/* Truncated from the left so the distinctive end of long paths stays visible. */}
                        <span className="wl-recent-path">
                          <bdi>{tildify(r.path, appInfo?.homeDir)}</bdi>
                        </span>
                      </span>
                      <span className="wl-recent-time">
                        {r.lastOpened
                          ? relativeTime(toUnixSeconds(r.lastOpened), now)
                          : ""}
                      </span>
                      <button
                        className="wl-recent-remove"
                        title="Remove from recent list"
                        aria-label={`Remove ${r.name} from recent list`}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(r);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <footer className="wl-footer">
            <span>
              {gitVersion
                ? `git ${gitVersion}`
                : appInfo
                  ? "git version unknown"
                  : ""}
            </span>
            {appInfo && <span>Adar {appInfo.version}</span>}
            <button
              className="ui-link"
              onClick={() => openModal({ kind: "about" })}
            >
              About
            </button>
            <button
              className="ui-link"
              onClick={() => openModal({ kind: "settings" })}
            >
              Settings
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Saved tab groups: one click reopens all of a project's repositories. */
function GroupList({
  groups,
  homeDir,
}: {
  groups: TabGroup[];
  homeDir: string | null;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const open = async (id: string) => {
    if (opening) return;
    setOpening(id);
    try {
      await openGroup(id);
    } finally {
      setOpening(null);
    }
  };
  const forget = (g: TabGroup) => useApp.getState().deleteGroup(g.id);
  return (
    <section className="wl-card wl-recent">
      <div className="wl-recent-head">
        <h2 className="wl-section-title">Groups</h2>
      </div>
      <div className="wl-recent-list">
        {groups.map((g) => {
          const names = g.repos.map(folderName);
          return (
            <div
              key={g.id}
              className={`wl-recent-item${opening === g.id ? " wl-opening" : ""}`}
              role="button"
              tabIndex={0}
              title={g.repos.map((p) => tildify(p, homeDir)).join("\n")}
              onClick={() => void open(g.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void open(g.id);
                }
              }}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "Open All", onClick: () => open(g.id) },
                  { label: "Rename…", onClick: () => renameGroup(g.id) },
                  {
                    label: "Forget Group",
                    danger: true,
                    onClick: () => forget(g),
                  },
                ])
              }
            >
              <span
                className="wl-recent-icon"
                style={{ color: `var(--group-${g.color})` }}
              >
                {opening === g.id ? (
                  <span className="ui-spinner ui-spinner-sm" />
                ) : (
                  <Layers size={16} />
                )}
              </span>
              <span className="wl-recent-text">
                <span className="wl-recent-name">
                  {g.name || "Unnamed group"}
                </span>
                <span className="wl-recent-path">
                  {summarizeList(names, 5)}
                </span>
              </span>
              <span className="wl-recent-time">
                {g.repos.length === 1
                  ? "1 repository"
                  : `${g.repos.length} repositories`}
              </span>
              <button
                className="wl-recent-remove"
                title="Forget this group (its repositories stay in the recent list)"
                aria-label={`Forget group ${g.name}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  forget(g);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
