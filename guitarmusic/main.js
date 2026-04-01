// main.js

import { AudioInput } from "./audio.js?v=20260401m";
import { GameScene } from "./gameScene.js?v=20260401m";

const startButton = document.getElementById("startButton");
const statusEl = document.getElementById("status");
const bgMusicInput = document.getElementById("bgMusicInput");
const testModeToggle = document.getElementById("testMode");
const songKeySelect = document.getElementById("songKey");
const scaleTypeSelect = document.getElementById("scaleType");

let gameInstance = null;
const defaultStartLabel = "Iniciar + Ativar Microfone";

function setStatus(message) {
  statusEl.textContent = message;
}

function syncStartButtonLabel() {
  if (testModeToggle.checked) {
    startButton.textContent = "Iniciar (Modo teste)";
    return;
  }

  startButton.textContent = defaultStartLabel;
}

syncStartButtonLabel();
testModeToggle.addEventListener("change", syncStartButtonLabel);
window.addEventListener("pageshow", syncStartButtonLabel);

startButton.addEventListener("click", async () => {
  if (gameInstance) {
    return;
  }

  if (typeof window.Phaser === "undefined") {
    setStatus("Erro: Phaser não carregou. Recarregue a página.");
    return;
  }

  const bgFile = bgMusicInput.files?.[0];
  const useKeyboard = Boolean(testModeToggle.checked);

  startButton.disabled = true;
  setStatus(
    useKeyboard
      ? "Iniciando modo teste..."
      : "Solicitando acesso ao microfone..."
  );

  const audioInput = new AudioInput({
    toleranceCents: 30,
    smoothing: 0.25,
  });

  try {
    await audioInput.init({ enableMicrophone: !useKeyboard });
  } catch (_error) {
    startButton.disabled = false;
    setStatus(
      useKeyboard
        ? "Falha ao iniciar áudio do navegador."
        : "Microfone indisponível ou acesso negado."
    );
    return;
  }

  let trackLoaded = false;
  let trackWarning = "";

  if (bgFile) {
    setStatus("Carregando música de fundo...");

    try {
      await audioInput.loadBackgroundTrack(bgFile);
      trackLoaded = true;
    } catch (_error) {
      trackWarning =
        "Não foi possível carregar a música escolhida. Iniciando sem trilha.";
    }
  }

  const songKey = songKeySelect.value;
  const scaleType = scaleTypeSelect.value;

  const config = {
    type: Phaser.AUTO,
    parent: "game-container",
    backgroundColor: "#100b19",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 960,
      height: 540,
    },
    scene: [
      new GameScene(audioInput, {
        songKey,
        scaleType,
        inputMode: useKeyboard ? "keyboard" : "instrument",
        backgroundTrackName: trackLoaded && bgFile ? bgFile.name : "",
        onStatus: setStatus,
      }),
    ],
  };

  const readyMessage = useKeyboard
    ? "Modo teste ativo. Use 1-5 para notas e 0 para forçar queda."
    : "Microfone ativo. Toque as notas para subir.";
  try {
    gameInstance = new Phaser.Game(config);
  } catch (error) {
    startButton.disabled = false;
    const message =
      error && error.message ? error.message : "erro desconhecido";
    setStatus(`Falha ao iniciar o jogo: ${message}`);
    return;
  }

  setStatus(trackWarning || readyMessage);
  startButton.style.display = "none";
});
