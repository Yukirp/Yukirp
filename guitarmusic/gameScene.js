// gameScene.js

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const NOTE_INDEX = NOTE_NAMES.reduce((acc, note, index) => {
  acc[note] = index;
  return acc;
}, {});

const PENTATONIC_INTERVALS = {
  minor: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 7, 9],
};

function buildPentatonic(root, scaleType) {
  const rootIndex = NOTE_INDEX[root] ?? NOTE_INDEX.A;
  const intervals = PENTATONIC_INTERVALS[scaleType] || PENTATONIC_INTERVALS.minor;

  return intervals.map((interval) => NOTE_NAMES[(rootIndex + interval) % 12]);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export class GameScene extends Phaser.Scene {
  constructor(audioInput, options = {}) {
    super("GameScene");
    this.audioInput = audioInput;
    this.options = options;
    this.runtimeError = null;
  }

  create() {
    try {
      this.songKey = this.options.songKey || "A";
      this.scaleType = this.options.scaleType === "major" ? "major" : "minor";
      this.inputMode =
        this.options.inputMode === "keyboard" ? "keyboard" : "instrument";
      this.allowedNotes = buildPentatonic(this.songKey, this.scaleType);
      this.allowedSet = new Set(this.allowedNotes);
      this.offScaleNote =
        NOTE_NAMES.find((note) => !this.allowedSet.has(note)) || "C#";
      this.lastKeyboardNote = null;
      this.globalKeydownHandler = null;

      this.onStatus =
        typeof this.options.onStatus === "function" ? this.options.onStatus : null;

      this.platformCount = 18;
      this.platformGap = 118;
      this.baseX = this.scale.width * 0.5;
      this.groundY = this.scale.height - 36;
      this.worldTop = this.groundY - this.platformCount * this.platformGap - 260;

      this.playerLevel = -1;
      this.isMoving = false;
      this.isFalling = false;
      this.isVictory = false;
      this.moveStartedAt = -1;

      this.noteCooldownMs = 240;
      this.minConfidence = 0.9;
      this.minRms = 0.01;
      this.lastTriggeredTime = -9999;
      this.lastTriggeredNote = null;

      this.createTextures();
      this.createBackground();
      this.createTower();
      this.createPlayer();
      this.createHud();
      this.createInputControls();

      this.cameras.main.setBounds(
        0,
        this.worldTop,
        this.scale.width,
        this.groundY - this.worldTop + 320
      );
      this.cameras.main.startFollow(this.player, false, 0.08, 0.08);
      this.cameras.main.setDeadzone(220, 120);
      this.cameras.main.setRoundPixels(true);

      this.audioInput.playBackgroundTrack({ loop: true, volume: 0.45 });

      this.highlightNextPlatform();
      this.refreshHud("Toque a nota da próxima plataforma");

      if (this.onStatus) {
        const scaleLabel = this.scaleType === "minor" ? "menor" : "maior";
        this.onStatus(
          `Música: ${this.options.backgroundTrackName || "faixa local"} | Pentatônica ${this.songKey} ${scaleLabel}`
        );
      }

      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.audioInput.stopBackgroundTrack();
        if (this.globalKeydownHandler) {
          document.removeEventListener("keydown", this.globalKeydownHandler);
          this.globalKeydownHandler = null;
        }
      });
    } catch (error) {
      this.runtimeError = error;
      const message =
        error && error.message ? error.message : "erro desconhecido";
      if (typeof this.options.onStatus === "function") {
        this.options.onStatus(`Erro ao criar cena: ${message}`);
      }
      this.cameras.main.setBackgroundColor("#2a1010");
      this.add
        .text(
          this.scale.width / 2,
          this.scale.height / 2,
          `Erro ao iniciar cena:\n${message}`,
          {
            fontFamily: "monospace",
            fontSize: "18px",
            color: "#ffd7d7",
            align: "center",
          }
        )
        .setOrigin(0.5, 0.5);
    }
  }

  createInputControls() {
    if (this.inputMode !== "keyboard") {
      return;
    }

    this.globalKeydownHandler = (event) => {
      const note = this.getNoteFromKeyboardEvent(event);
      if (!note) {
        return;
      }

      if (event.repeat) {
        return;
      }

      event.preventDefault();
      this.triggerInputNote(note);
    };
    document.addEventListener("keydown", this.globalKeydownHandler);

    this.createPointerControls();
  }

  triggerInputNote(note) {
    this.lastKeyboardNote = note;

    if (this.runtimeError || this.isMoving || this.isFalling || this.isVictory) {
      return;
    }

    this.processTriggeredNote(note);
  }

  getNoteFromKeyboardEvent(event) {
    const byCode = {
      Digit1: this.allowedNotes[0],
      Digit2: this.allowedNotes[1],
      Digit3: this.allowedNotes[2],
      Digit4: this.allowedNotes[3],
      Digit5: this.allowedNotes[4],
      Digit0: this.offScaleNote,
      Numpad1: this.allowedNotes[0],
      Numpad2: this.allowedNotes[1],
      Numpad3: this.allowedNotes[2],
      Numpad4: this.allowedNotes[3],
      Numpad5: this.allowedNotes[4],
      Numpad0: this.offScaleNote,
    };

    if (byCode[event.code]) {
      return byCode[event.code];
    }

    const byKey = {
      "1": this.allowedNotes[0],
      "2": this.allowedNotes[1],
      "3": this.allowedNotes[2],
      "4": this.allowedNotes[3],
      "5": this.allowedNotes[4],
      "0": this.offScaleNote,
    };

    return byKey[event.key] || null;
  }

  createPointerControls() {
    const buttonDefs = [
      ...this.allowedNotes.map((note, index) => ({
        note,
        label: `${index + 1}:${note}`,
        offScale: false,
      })),
      {
        note: this.offScaleNote,
        label: `0:${this.offScaleNote}`,
        offScale: true,
      },
    ];

    const buttonWidth = 102;
    const gap = 10;
    const totalWidth =
      buttonDefs.length * buttonWidth + (buttonDefs.length - 1) * gap;
    const startX = (this.scale.width - totalWidth) / 2 + buttonWidth / 2;
    const y = this.scale.height - 28;

    this.pointerButtons = [];

    buttonDefs.forEach((button, index) => {
      const x = startX + index * (buttonWidth + gap);
      const fillColor = button.offScale ? 0x8a2d2d : 0x6f4f20;

      const bg = this.add
        .rectangle(x, y, buttonWidth, 34, fillColor, 0.95)
        .setStrokeStyle(2, 0xd3b36b)
        .setScrollFactor(0)
        .setDepth(42)
        .setInteractive({ useHandCursor: true });

      const text = this.add
        .text(x, y, button.label, {
          fontFamily: "Press Start 2P",
          fontSize: "10px",
          color: "#f9e6bc",
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(43)
        .setInteractive({ useHandCursor: true });

      const trigger = () => {
        this.triggerInputNote(button.note);

        this.tweens.add({
          targets: [bg, text],
          scaleX: 0.94,
          scaleY: 0.94,
          yoyo: true,
          duration: 80,
          ease: "Sine.InOut",
        });
      };

      bg.on("pointerdown", trigger);
      text.on("pointerdown", trigger);

      this.pointerButtons.push({ bg, text });
    });
  }

  createTextures() {
    const g = this.add.graphics();

    g.fillStyle(0x8c6a2f, 1);
    g.fillRect(0, 0, 140, 28);
    g.fillStyle(0x6f4f20, 1);
    g.fillRect(0, 20, 140, 8);
    g.lineStyle(2, 0xd3b36b, 0.9);
    g.strokeRect(1, 1, 138, 26);
    g.generateTexture("towerPlatform", 140, 28);

    g.clear();
    g.fillStyle(0x111111, 1);
    g.fillRect(0, 0, 28, 34);
    g.fillStyle(0xd8b47c, 1);
    g.fillRect(4, 4, 20, 10);
    g.fillStyle(0x8a2d2d, 1);
    g.fillRect(4, 14, 20, 18);
    g.fillStyle(0xf5e8c8, 1);
    g.fillRect(10, 20, 8, 8);
    g.generateTexture("hero", 28, 34);

    g.clear();
    g.fillStyle(0x4d355f, 1);
    g.fillRect(0, 0, 18, 18);
    g.fillStyle(0x6d4d84, 1);
    g.fillRect(2, 2, 14, 14);
    g.generateTexture("brick", 18, 18);

    g.destroy();
  }

  createBackground() {
    this.add
      .rectangle(
        this.scale.width / 2,
        this.worldTop + 40,
        this.scale.width,
        this.groundY - this.worldTop + 500,
        0x120d1c
      )
      .setDepth(-20);

    const moon = this.add.circle(this.scale.width - 130, this.worldTop + 140, 48, 0xf4db9f);
    moon.setDepth(-15);
    moon.setScrollFactor(0.25);

    for (let i = 0; i < 95; i += 1) {
      const x = 30 + ((i * 97) % (this.scale.width - 60));
      const y = this.worldTop + 20 + ((i * 43) % 2100);
      const star = this.add.rectangle(x, y, 2, 2, 0xf6efcc, 0.65);
      star.setDepth(-18);
      star.setScrollFactor(0.15);
    }

    const towerX = this.baseX;
    const towerHeight = this.groundY - this.worldTop + 320;

    this.add
      .rectangle(towerX, this.groundY - towerHeight / 2 + 130, 420, towerHeight, 0x241733)
      .setDepth(-12);

    for (let y = this.groundY - 40; y > this.worldTop + 20; y -= 36) {
      for (let x = towerX - 180; x <= towerX + 170; x += 18) {
        this.add.image(x, y, "brick").setDepth(-10).setAlpha(0.82);
      }
    }

    for (let y = this.groundY - 70; y > this.worldTop + 80; y -= 110) {
      this.add.rectangle(towerX - 110, y, 10, 16, 0xf7c96a, 0.8).setDepth(-8);
      this.add.rectangle(towerX + 110, y + 25, 10, 16, 0xf7c96a, 0.8).setDepth(-8);
    }

    this.add
      .rectangle(this.scale.width / 2, this.groundY + 28, this.scale.width + 100, 80, 0x221728)
      .setDepth(-5);
  }

  createTower() {
    this.platforms = [];

    const laneOffsets = [-190, -60, 70, 200];

    for (let i = 0; i < this.platformCount; i += 1) {
      const lane = laneOffsets[i % laneOffsets.length];
      const x = this.baseX + lane + Phaser.Math.Between(-14, 14);
      const y = this.groundY - (i + 1) * this.platformGap;
      const note = pickRandom(this.allowedNotes);

      const platform = this.add.image(x, y, "towerPlatform");
      platform.setDepth(3);
      platform.setData("index", i);
      platform.setData("note", note);

      const noteLabel = this.add.text(x, y - 1, note, {
        fontFamily: "Press Start 2P",
        fontSize: "12px",
        color: "#f9e6bc",
      });
      noteLabel.setOrigin(0.5, 0.5);
      noteLabel.setDepth(4);

      this.platforms.push({
        sprite: platform,
        label: noteLabel,
        x,
        y,
        note,
        index: i,
      });
    }

    this.add
      .rectangle(this.baseX, this.groundY + 6, 220, 28, 0x7a5b2d)
      .setDepth(2)
      .setStrokeStyle(2, 0xd3b36b);
  }

  createPlayer() {
    this.player = this.add.sprite(this.baseX, this.groundY - 8, "hero");
    this.player.setOrigin(0.5, 1);
    this.player.setDepth(10);

    this.playerShadow = this.add.ellipse(this.baseX, this.groundY + 6, 38, 12, 0x000000, 0.3);
    this.playerShadow.setDepth(1);
  }

  createHud() {
    const hudSmall = {
      fontFamily: "Press Start 2P",
      fontSize: "10px",
      color: "#f4dfb0",
    };

    this.titleText = this.add.text(16, 14, "PENTATONIC KING", {
      fontFamily: "Press Start 2P",
      fontSize: "12px",
      color: "#f3bf55",
    });
    this.titleText.setScrollFactor(0);

    const scaleLabel = this.scaleType === "minor" ? "Menor" : "Maior";

    this.keyText = this.add.text(16, 36, `Tom: ${this.songKey} ${scaleLabel}`, hudSmall);
    this.keyText.setScrollFactor(0);

    this.allowedText = this.add.text(
      16,
      54,
      `Pentatonica: ${this.allowedNotes.join(" ")}`,
      hudSmall
    );
    this.allowedText.setScrollFactor(0);

    this.progressText = this.add.text(16, 72, "Progresso: 0/18", hudSmall);
    this.progressText.setScrollFactor(0);

    this.expectedText = this.add.text(16, 90, "Proxima: --", hudSmall);
    this.expectedText.setScrollFactor(0);

    this.detectedText = this.add.text(16, 108, "Detectado: --", hudSmall);
    this.detectedText.setScrollFactor(0);

    const controlsLabel =
      this.inputMode === "keyboard"
        ? `Teclas: 1-5 notas | 0 derruba (acerte a Proxima)`
        : "Controle: instrumento em tempo real";
    this.controlsText = this.add.text(16, 126, controlsLabel, {
      fontFamily: "Press Start 2P",
      fontSize: "9px",
      color: "#e7cd94",
    });
    this.controlsText.setScrollFactor(0);

    this.feedbackText = this.add.text(this.scale.width / 2, 26, "", {
      fontFamily: "Press Start 2P",
      fontSize: "12px",
      color: "#f6edcf",
      align: "center",
    });
    this.feedbackText.setOrigin(0.5, 0);
    this.feedbackText.setScrollFactor(0);
  }

  refreshHud(message, color = "#f6edcf") {
    const next = this.getNextPlatform();

    this.progressText.setText(`Progresso: ${Math.max(0, this.playerLevel + 1)}/${this.platformCount}`);
    this.expectedText.setText(next ? `Proxima: ${next.note}` : "Proxima: TOPO");

    if (message) {
      this.feedbackText.setText(message);
      this.feedbackText.setColor(color);
    }
  }

  getNextPlatform() {
    return this.platforms[this.playerLevel + 1] || null;
  }

  clearPulseTween() {
    if (this.nextPlatformTween) {
      this.nextPlatformTween.stop();
      this.nextPlatformTween = null;
    }
  }

  highlightNextPlatform() {
    this.clearPulseTween();

    const next = this.getNextPlatform();
    if (!next) {
      return;
    }

    this.nextPlatformTween = this.tweens.add({
      targets: next.sprite,
      alpha: { from: 1, to: 0.62 },
      yoyo: true,
      repeat: -1,
      duration: 300,
      ease: "Sine.InOut",
    });
  }

  onCorrectNote(platformData) {
    if (this.isMoving || this.isFalling || this.isVictory) {
      return;
    }

    this.isMoving = true;
    this.moveStartedAt = this.time.now;
    this.clearPulseTween();

    platformData.sprite.setAlpha(1);
    platformData.sprite.setTint(0x69c47a);
    platformData.label.setColor("#102311");

    const jumpTopY = Math.min(this.player.y, platformData.y - 80);

    const completeJump = () => {
      this.playerLevel = platformData.index;
      this.isMoving = false;
      this.moveStartedAt = -1;

      if (this.playerLevel >= this.platformCount - 1) {
        this.onVictory();
        return;
      }

      this.refreshHud("Acerto! Subiu.", "#73e089");
      this.highlightNextPlatform();
    };

    const onTweenUpdate = () => {
      this.playerShadow.x = this.player.x;
    };

    try {
      if (!this.tweens || typeof this.tweens.add !== "function") {
        this.player.setPosition(platformData.x, platformData.y - 12);
        onTweenUpdate();
        completeJump();
        return;
      }

      this.tweens.add({
        targets: this.player,
        x: platformData.x,
        y: jumpTopY,
        duration: 210,
        ease: "Sine.Out",
        onUpdate: onTweenUpdate,
        onComplete: () => {
          this.tweens.add({
            targets: this.player,
            x: platformData.x,
            y: platformData.y - 12,
            duration: 240,
            ease: "Sine.In",
            onUpdate: onTweenUpdate,
            onComplete: completeJump,
            onStop: () => this.recoverMovementLock("Pulo interrompido."),
          });
        },
        onStop: () => this.recoverMovementLock("Pulo interrompido."),
      });
    } catch (_error) {
      this.recoverMovementLock("Falha de animação. Tentando continuar.");
    }
  }

  recoverMovementLock(message) {
    this.isMoving = false;
    this.moveStartedAt = -1;
    if (message) {
      this.refreshHud(message, "#ffd88a");
    }
  }

  onScaleNoteButWrong(note) {
    if (this.isMoving || this.isFalling || this.isVictory) {
      return;
    }

    const next = this.getNextPlatform();
    this.refreshHud(
      `Nota ${note} na escala, mas esperava ${next ? next.note : "--"}`,
      "#f3d48a"
    );

    this.tweens.add({
      targets: this.player,
      x: this.player.x + Phaser.Math.Between(-6, 6),
      duration: 80,
      yoyo: true,
      repeat: 1,
      ease: "Sine.InOut",
      onComplete: () => {
        this.player.x = Math.round(this.player.x);
      },
    });
  }

  onWrongScaleNote(note) {
    if (this.isFalling || this.isVictory) {
      return;
    }

    this.isFalling = true;
    this.isMoving = false;
    this.clearPulseTween();

    this.player.setTint(0xd65a5a);
    this.cameras.main.shake(220, 0.008);
    this.refreshHud(`Nota ${note} fora da pentatonica. Caiu!`, "#ff8080");

    const dropDuration = 520 + Math.max(0, this.playerLevel + 1) * 24;
    const targetX = this.baseX;
    const targetY = this.groundY - 8;
    const hasDistanceToFall =
      Math.abs(this.player.x - targetX) > 1 ||
      Math.abs(this.player.y - targetY) > 1 ||
      this.playerLevel >= 0;

    if (!hasDistanceToFall) {
      this.time.delayedCall(180, () => {
        this.finishFallReset();
      });
      return;
    }

    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: targetY,
      duration: dropDuration,
      ease: "Quad.In",
      onUpdate: () => {
        this.playerShadow.x = this.player.x;
      },
      onComplete: () => {
        this.finishFallReset();
      },
    });
  }

  finishFallReset() {
    this.player.clearTint();
    this.playerLevel = -1;
    this.isFalling = false;

    this.platforms.forEach((platform) => {
      platform.sprite.clearTint();
      platform.sprite.setAlpha(1);
      platform.label.setColor("#f9e6bc");
    });

    this.refreshHud("Retornou ao inicio.", "#f6edcf");
    this.highlightNextPlatform();
  }

  onVictory() {
    this.isVictory = true;
    this.clearPulseTween();
    this.refreshHud("Rei da torre!", "#f7d77f");

    this.tweens.add({
      targets: this.player,
      y: this.player.y - 18,
      yoyo: true,
      repeat: 5,
      duration: 180,
      ease: "Sine.InOut",
      onUpdate: () => {
        this.playerShadow.x = this.player.x;
      },
    });

    if (this.onStatus) {
      this.onStatus("Vitoria! Você chegou ao topo.");
    }
  }

  processTriggeredNote(note) {
    const next = this.getNextPlatform();
    if (!next) {
      return;
    }

    if (!this.allowedSet.has(note)) {
      this.onWrongScaleNote(note);
      return;
    }

    if (note === next.note) {
      this.onCorrectNote(next);
      return;
    }

    this.onScaleNoteButWrong(note);
  }

  updatePitchDisplay(pitch) {
    if (this.inputMode === "keyboard") {
      const label = this.lastKeyboardNote || "--";
      this.detectedText.setText(`Detectado: ${label} [teclado]`);
      return;
    }

    if (!pitch) {
      this.detectedText.setText("Detectado: --");
      return;
    }

    const suffix = pitch.inTune ? "" : " ~";
    this.detectedText.setText(`Detectado: ${pitch.name} (${pitch.cents}c)${suffix}`);
  }

  shouldTriggerNote(time, pitch) {
    if (!pitch || !pitch.inTune) {
      return false;
    }

    if (pitch.confidence < this.minConfidence || pitch.rms < this.minRms) {
      return false;
    }

    const sameNote = pitch.note === this.lastTriggeredNote;
    if (sameNote && time - this.lastTriggeredTime < this.noteCooldownMs) {
      return false;
    }

    if (!sameNote && time - this.lastTriggeredTime < 110) {
      return false;
    }

    return true;
  }

  update(time) {
    if (this.runtimeError) {
      return;
    }

    if (this.inputMode === "keyboard") {
      if (
        this.isMoving &&
        this.moveStartedAt > 0 &&
        time - this.moveStartedAt > 2200
      ) {
        this.recoverMovementLock("Destravado.");
      }
      this.updatePitchDisplay(null);
      return;
    }

    const pitch = this.audioInput.getPitchInfo();
    this.updatePitchDisplay(pitch);

    if (this.isMoving || this.isFalling || this.isVictory) {
      return;
    }

    if (!this.shouldTriggerNote(time, pitch)) {
      return;
    }

    this.lastTriggeredTime = time;
    this.lastTriggeredNote = pitch.note;

    this.processTriggeredNote(pitch.note);
  }
}
