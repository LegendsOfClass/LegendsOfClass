import Phaser from 'phaser';
import { EventBus } from '../../EventBus';
import { getProfile } from '../../state/store';
import { rtJoin, rtSendMove, type RtPlayer } from '../../net/realtime';

interface RemoteView {
  sprite: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Text;
  bubbleTimer?: Phaser.Time.TimerEvent;
}

/**
 * Base scene for walkable maps (M2): local click-to-move + presence rendering.
 * Subclasses (Town/Field) add their own props on top via createWorld().
 * Positions on the wire are normalized 0..1 so different screen sizes line up.
 */
export abstract class WorldScene extends Phaser.Scene {
  protected player!: Phaser.GameObjects.Sprite;
  protected nameTag!: Phaser.GameObjects.Text;
  protected target: Phaser.Math.Vector2 | null = null;
  private remotes = new Map<string, RemoteView>();
  private offs: (() => void)[] = [];
  private lastSent = 0;
  private lastSentPos = { x: -1, y: -1 };

  protected abstract mapId(): string;
  /** Subclass world content (background, props). Called before the player spawns. */
  protected abstract createWorld(w: number, h: number): void;

  create() {
    const { width: w, height: h } = this.scale;
    this.remotes.clear();
    this.target = null;
    this.createWorld(w, h);

    const jobId = getProfile()?.state.current_job_id ?? 'swordman';
    this.player = this.add.sprite(w * 0.5, h * 0.7, this.unitTex(jobId)).setDepth(10);
    this.nameTag = this.add.text(this.player.x, 0, getProfile()?.account.display_name ?? '', { fontSize: '12px', color: '#fff' }).setOrigin(0.5).setDepth(10);
    this.syncTag();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.target = new Phaser.Math.Vector2(p.worldX, p.worldY);
    });

    // presence wiring
    this.offs = [
      EventBus.on('rt-welcome', (m: { id: string; players: RtPlayer[] }) => {
        this.clearRemotes();
        for (const p of m.players) if (p.id !== m.id) this.addRemote(p);
      }),
      EventBus.on('rt-add', (p: RtPlayer) => this.addRemote(p)),
      EventBus.on('rt-update', (p: RtPlayer) => this.updateRemote(p)),
      EventBus.on('rt-move', (m: { id: string; x: number; y: number }) => this.moveRemote(m)),
      EventBus.on('rt-remove', (id: string) => this.removeRemote(id)),
      EventBus.on('rt-chat', (m: { id: string; text: string }) => this.showBubble(m.id, m.text)),
      EventBus.on('profile', () => {
        const j = getProfile()?.state.current_job_id ?? 'swordman';
        if (this.player?.active) this.player.setTexture(this.unitTex(j));
      }),
    ];
    this.events.once('shutdown', () => { this.offs.forEach(o => o()); this.offs = []; });

    rtJoin(this.mapId());
  }

  update(_: number, dtMs: number) {
    this.subUpdate(dtMs);
    if (!this.target) return;
    const speed = 220 * (dtMs / 1000);
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.target.x, this.target.y);
    if (d <= speed) { this.player.setPosition(this.target.x, this.target.y); this.target = null; }
    else {
      const a = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.target.x, this.target.y);
      this.player.x += Math.cos(a) * speed; this.player.y += Math.sin(a) * speed;
    }
    this.syncTag();
    this.broadcastPos();
  }

  /** Subclass per-frame hook (hotspot checks etc.). */
  protected subUpdate(_dtMs: number): void { /* default: nothing */ }

  protected unitTex(jobOrMonsterId: string): string {
    const key = `unit.${jobOrMonsterId}`;
    return this.textures.exists(key) ? key : 'unit.fallback';
  }

  private syncTag() {
    this.nameTag.setPosition(this.player.x, this.player.y - this.player.displayHeight / 2 - 12);
  }

  private broadcastPos() {
    const now = this.time.now;
    if (now - this.lastSent < 100) return; // ≤10 msg/s
    const nx = this.player.x / this.scale.width;
    const ny = this.player.y / this.scale.height;
    if (Math.abs(nx - this.lastSentPos.x) < 0.002 && Math.abs(ny - this.lastSentPos.y) < 0.002) return;
    this.lastSent = now; this.lastSentPos = { x: nx, y: ny };
    rtSendMove(nx, ny);
  }

  // ---- remote players ----
  private addRemote(p: RtPlayer) {
    if (this.remotes.has(p.id)) { this.updateRemote(p); return; }
    const x = p.x * this.scale.width, y = p.y * this.scale.height;
    const sprite = this.add.sprite(x, y, this.unitTex(p.job)).setAlpha(0.92).setDepth(5);
    const tag = this.add.text(x, y - sprite.displayHeight / 2 - 12, p.name, { fontSize: '11px', color: '#cfe3ff' }).setOrigin(0.5).setDepth(5);
    this.remotes.set(p.id, { sprite, tag });
  }

  private updateRemote(p: RtPlayer) {
    const v = this.remotes.get(p.id);
    if (!v) { this.addRemote(p); return; }
    v.sprite.setTexture(this.unitTex(p.job));
    v.tag.setText(p.name);
  }

  private moveRemote(m: { id: string; x: number; y: number }) {
    const v = this.remotes.get(m.id); if (!v) return;
    const x = m.x * this.scale.width, y = m.y * this.scale.height;
    this.tweens.add({
      targets: v.sprite, x, y, duration: 140, ease: 'Linear',
      onUpdate: () => {
        v.tag.setPosition(v.sprite.x, v.sprite.y - v.sprite.displayHeight / 2 - 12);
        v.bubble?.setPosition(v.sprite.x, v.sprite.y - v.sprite.displayHeight / 2 - 30);
      },
    });
  }

  private removeRemote(id: string) {
    const v = this.remotes.get(id); if (!v) return;
    v.bubbleTimer?.remove();
    v.sprite.destroy(); v.tag.destroy(); v.bubble?.destroy();
    this.remotes.delete(id);
  }

  private clearRemotes() { for (const id of [...this.remotes.keys()]) this.removeRemote(id); }

  /** Small speech bubble above the speaker (town feels alive). */
  private showBubble(id: string, text: string) {
    const v = this.remotes.get(id);
    const anchor = v?.sprite ?? this.player; // own messages float above self
    const holder: { bubble?: Phaser.GameObjects.Text; bubbleTimer?: Phaser.Time.TimerEvent } = v ?? this.ownBubble;
    holder.bubble?.destroy(); holder.bubbleTimer?.remove();
    const bubble = this.add.text(anchor.x, anchor.y - anchor.displayHeight / 2 - 30, text.slice(0, 40),
      { fontSize: '11px', color: '#111', backgroundColor: '#ffffffee', padding: { x: 6, y: 3 } })
      .setOrigin(0.5).setDepth(20);
    holder.bubble = bubble;
    holder.bubbleTimer = this.time.delayedCall(3500, () => { bubble.destroy(); holder.bubble = undefined; });
  }
  private ownBubble: { bubble?: Phaser.GameObjects.Text; bubbleTimer?: Phaser.Time.TimerEvent } = {};
}
