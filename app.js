/**
 * Radio Stream Player with Delay Control
 * Vanilla JavaScript implementation
 */

class RadioPlayer {
    constructor() {
        // DOM Elements
        this.streamSelector = document.getElementById('stream-selector');
        this.playBtn = document.getElementById('play-btn');
        this.pauseBtn = document.getElementById('pause-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.delayValue = document.getElementById('delay-value');
        this.delaySlider = document.getElementById('delay-slider');
        // this.statusEl = document.getElementById('status'); // Eliminado
        this.delayButtons = document.querySelectorAll('[data-delay]'); // Soporta ambas versiones
        this.goLiveBtn = document.getElementById('go-live-btn');
        this.volumeSlider = document.getElementById('volume-slider');
        this.volumeValue = document.getElementById('volume-value');
        this.muteBtn = document.getElementById('mute-btn');
        this.visualizerBars = document.querySelectorAll('.visualizer-bar');
        this.visualizerStatus = document.getElementById('visualizer-status');

        // Custom streams
        this.customStreamName = document.getElementById('custom-stream-name');
        this.customStreamUrl = document.getElementById('custom-stream-url');
        this.addCustomStreamBtn = document.getElementById('add-custom-stream-btn');
        this.customStreamsList = document.getElementById('custom-streams-list');
        this.customStreams = [];

        // Official streams (hardcoded from HTML)
        this.officialStreams = [
            { name: 'Cadena 3', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/radio3.mp3' },
            { name: 'Sucesos', url: 'https://server1.dainusradio.com:2341/stream' },
            { name: 'Suquia', url: 'https://streaming01.shockmedia.com.ar:10945/;' },
            {
                name: 'Continental Córdoba',
                // url: 'https://edge01.radiohdvivo.com/continental',
                url: 'https://streaming.gostreaming.com.ar/8100/;'
            },
            {
                name: 'Gol & Pop',
                url: 'https://streaming01.serverconnectinc.site:9515/golpop',
                error: "Gol & Pop no permite conexiones externas. Pediles que lo cambien o que nos escriban"
            },
            {
                name: 'LV2',
                url: 'https://ice3.edge-apps.net/ros3-lv2/live/playlist.m3u8',
                error: "LV2 no permite conexiones externas. Pediles que lo cambien o que nos escriban"
            },
            
        ];

        // Audio state
        this.audio = null;
        this.currentDelay = 0; // Iniciar en 0, se incrementará durante buffering
        this.targetDelay = 10000; // Delay objetivo después del buffering inicial
        this.maxDelay = 180000; // 3 minutos máximo (límite del navegador)
        this.isPlaying = false;
        this.isPaused = false;
        this.isResuming = false; // Flag para indicar que estamos reanudando
        this.isStopping = false; // Flag para indicar que estamos deteniendo intencionalmente
        this.currentStreamUrl = '';
        this.currentStreamError = null; // Error message for current stream (CORS, etc.)
        this.volume = 1.0;
        this.isMuted = false;
        this.volumeBeforeMute = 1.0;

        // Pause tracking
        this.pauseDelayInterval = null;
        
        // Cache tracking
        this.cacheStartTime = null; // Cuándo empezó a acumular cache
        this.availableCache = 0; // Milisegundos de cache disponible
        this.cacheUpdateInterval = null; // Intervalo para actualizar cache disponible
        this.bufferingDelayInterval = null; // Intervalo para incrementar delay durante buffering
        
        // Web Audio API (for delay control)
        this.audioContext = null;
        this.sourceNode = null;
        this.delayNode = null;
        this.gainNode = null;
        this.analyserNode = null;
        this.useWebAudio = false;

        // Equalizer - Configuración adaptativa según el DOM
        this.eqFilters = [];
        this.eqBands = [];
        this.eqSliders = [];

        // Detectar cuántas bandas hay en el HTML y configurar dinámicamente
        this.setupEQBands();

        // Visualizer
        this.visualizerInterval = null;
        this.dataArray = null;
        this.visualizerMode = 'idle'; // 'idle', 'buffering'
        this.bufferingStartTime = null;
        this.bufferingDuration = 10000; // 10 segundos de buffering inicial

        this.init();
    }
    
    init() {
        this.loadCustomStreams();
        this.bindEvents();
        this.initEqualizer();
        this.updateDelayDisplay();
        this.hideVisualizer(); // Ocultar visualizador inicialmente
        this.updateMuteButton(); // Asegurar que el botón de mute refleje el estado inicial
        this.updateStreamSelector();
        this.renderCustomStreamsList();
    }

    hideVisualizer() {
        // Ocultar todas las barras
        this.visualizerBars.forEach(bar => {
            bar.style.display = 'none';
        });
    }

    setVisualizerBar(percent) {
        // Mostrar solo la primera barra como barra de progreso
        if (this.visualizerBars.length > 0) {
            const bar = this.visualizerBars[0];
            bar.style.display = 'block';
            bar.style.width = percent + '%';
            bar.style.transform = 'translateX(0)';
            bar.classList.add('buffering');
            bar.classList.remove('overlapping');
        }
    }

    setVisualizerStatus(text) {
        if (this.visualizerStatus) {
            this.visualizerStatus.textContent = text;
        }
    }
    
    bindEvents() {
        this.streamSelector.addEventListener('change', (e) => {
            this.handleStreamChange(e.target.value);
        });
        
        if (this.playBtn) {
            this.playBtn.addEventListener('click', () => {
                if (this.isPaused) {
                    this.resume();
                } else {
                    this.play();
                }
            });
        }

        if (this.pauseBtn) {
            this.pauseBtn.addEventListener('click', () => {
                this.pause();
            });
        }

        if (this.stopBtn) {
            this.stopBtn.addEventListener('click', () => {
                this.stop();
            });
        }
        
        this.delayButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Use currentTarget to get the button, not the clicked child element
                const delayChange = parseInt(e.currentTarget.dataset.delay, 10);

                // Skip if no valid delay value
                if (isNaN(delayChange)) {
                    console.warn('Botón sin data-delay válido:', e.currentTarget);
                    return;
                }

                this.adjustDelay(delayChange);
            });
        });

        // Delay slider
        if (this.delaySlider) {
            this.delaySlider.addEventListener('input', (e) => {
                this.setDelayFromSlider(parseInt(e.target.value, 10));
            });
        }

        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', (e) => {
                this.setVolume(e.target.value / 100);
            });
        }

        if (this.muteBtn) {
            this.muteBtn.addEventListener('click', () => {
                this.toggleMute();
            });
        }

        // Go Live button
        if (this.goLiveBtn) {
            this.goLiveBtn.addEventListener('click', () => {
                this.goToLive();
            });
        }

        // EQ Toggle button
        const eqToggleBtn = document.getElementById('eq-toggle-btn');
        if (eqToggleBtn) {
            eqToggleBtn.addEventListener('click', () => {
                this.toggleEqualizer();
            });
        }

        // EQ Reset button
        const eqResetBtn = document.getElementById('eq-reset-btn');
        if (eqResetBtn) {
            eqResetBtn.addEventListener('click', () => {
                this.resetEqualizer();
            });
        }

        // Custom stream add button
        if (this.addCustomStreamBtn) {
            this.addCustomStreamBtn.addEventListener('click', () => {
                this.addCustomStream();
            });
        }

        // Allow Enter key to add custom stream
        if (this.customStreamUrl) {
            this.customStreamUrl.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addCustomStream();
                }
            });
        }
        if (this.customStreamName) {
            this.customStreamName.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addCustomStream();
                }
            });
        }
    }
    
    handleStreamChange(url) {
        this.currentStreamUrl = url;

        // Track stream selection
        if (url && typeof plausible !== 'undefined') {
            const stream = this.officialStreams.find(s => s.url === url) ||
                          this.customStreams.find(s => s.url === url);
            if (stream) {
                plausible('Stream Selected', { props: { stream: stream.name } });
            }
        }

        // Limpiar errores de conexión al cambiar de stream
        const hadConnectionError = this.currentStreamError !== null &&
            !this.officialStreams.some(s => s.url === this.currentStreamUrl && s.error) &&
            !this.customStreams.some(s => s.url === this.currentStreamUrl && s.error);

        if (hadConnectionError) {
            this.currentStreamError = null;
        }

        if (this.isPlaying) {
            this.stop();
        }

        // Resetear delay a 0 cuando se cambia de stream
        this.currentDelay = 0;
        this.updateDelayDisplay();

        // Verificar si el stream seleccionado tiene un error conocido (predefinido)
        // Limpiar errores de conexión previos
        this.currentStreamError = null;
        if (url) {
            // Buscar en streams oficiales
            const officialStream = this.officialStreams.find(s => s.url === url);
            if (officialStream && officialStream.error) {
                this.currentStreamError = officialStream.error;
            }

            // Buscar en streams personalizados
            const customStream = this.customStreams.find(s => s.url === url);
            if (customStream && customStream.error) {
                this.currentStreamError = customStream.error;
            }
        }

        // Cargar preset de EQ para este stream
        this.loadEQPreset(url);

        // Mostrar visualizador de nuevo
        if (url) {
            this.visualizerMode = 'idle';
            this.setVisualizerBar(0);
        } else {
            this.hideVisualizer();
        }

        // Actualizar display de error/delay
        this.updateErrorDisplay();

        // Actualizar todos los controles
        this.updateControls();

        if (url) {
            if (this.currentStreamError) {
                // No mostrar mensaje en visualizer status, se muestra en el display principal
                this.setVisualizerStatus('');
            } else {
                // this.setStatus('Stream seleccionado. Presiona ▶ para comenzar.', 'stopped');
                this.setVisualizerStatus('Presiona ▶ para reproducir');
            }
        } else {
            // this.setStatus('Sin conexión', '');
            this.setVisualizerStatus('Selecciona un stream');
        }
    }

    updateErrorDisplay() {
        if (this.currentStreamError) {
            // Ocultar contador de delay y mostrar mensaje de error grande
            if (this.delayValue) {
                this.delayValue.style.display = 'none';
            }

            // Crear o actualizar elemento de error
            let errorDisplay = document.getElementById('stream-error-display');
            if (!errorDisplay) {
                errorDisplay = document.createElement('div');
                errorDisplay.id = 'stream-error-display';
                errorDisplay.className = 'led-display'; // Reutilizar estilos del display
                errorDisplay.style.color = '#ff4444';
                errorDisplay.style.textShadow = '0 0 8px #ff4444';
                errorDisplay.style.fontSize = '18px';
                errorDisplay.style.lineHeight = '1.4';
                errorDisplay.style.padding = '16px';
                this.delayValue.parentNode.insertBefore(errorDisplay, this.delayValue);
            }
            errorDisplay.textContent = '⚠️ ERROR: ' + this.currentStreamError;
            errorDisplay.style.display = 'block';
        } else {
            // Mostrar contador de delay y ocultar error
            if (this.delayValue) {
                this.delayValue.style.display = 'block';
            }

            const errorDisplay = document.getElementById('stream-error-display');
            if (errorDisplay) {
                errorDisplay.style.display = 'none';
            }
        }
    }
    
    async play() {
        if (!this.currentStreamUrl) {
            // this.setStatus('Por favor, selecciona un stream primero.', 'error');
            return;
        }

        // Track play action
        if (typeof plausible !== 'undefined') {
            const stream = this.officialStreams.find(s => s.url === this.currentStreamUrl) ||
                          this.customStreams.find(s => s.url === this.currentStreamUrl);
            plausible('Play', { props: { stream: stream?.name || 'Unknown' } });
        }

        // Limpiar errores de conexión previos (intentar de nuevo)
        // pero mantener errores predefinidos
        const hadPredefinedError = this.currentStreamError !== null &&
            (this.officialStreams.some(s => s.url === this.currentStreamUrl && s.error) ||
             this.customStreams.some(s => s.url === this.currentStreamUrl && s.error));

        if (!hadPredefinedError) {
            this.currentStreamError = null;
            this.updateErrorDisplay();
        }

        // Desactivar controles inmediatamente
        this.isPlaying = true;
        this.updateControls();

        // this.setStatus('Conectando...', 'loading');
        this.setVisualizerStatus('Conectando...');

        try {
            this.audio = new Audio();
            this.audio.volume = this.volume;
            this.audio.muted = this.isMuted;
            
            this.audio.onplaying = () => {
                // Si estamos reanudando, solo limpiar el flag y salir
                if (this.isResuming) {
                    this.isResuming = false;
                    return;
                }

                // No actualizar si está pausado (evita que eventos automáticos reseteen el estado)
                if (this.isPaused) {
                    return;
                }

                this.isPlaying = true;
                this.updateControls();

                if (this.useWebAudio) {
                    // Iniciar modo buffering y rastreo de cache
                    this.visualizerMode = 'buffering';
                    this.bufferingStartTime = Date.now();
                    this.cacheStartTime = Date.now();
                    this.availableCache = 0;
                    this.currentDelay = 0; // Resetear delay a 0 al empezar

                    // SILENCIAR audio durante buffering para evitar glitches
                    if (this.gainNode && this.audioContext) {
                        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
                    }

                    this.startCacheTracking();
                    this.startBufferingDelayTracking(); // Incrementar delay durante buffering

                    // this.setStatus('🎵 Llenando cache...', 'loading');
                    this.setVisualizerStatus('');
                    this.startVisualizer();

                    // Después del tiempo de buffering, activar audio y marcar como listo
                    setTimeout(() => {
                        if (this.isPlaying && !this.isPaused) {
                            this.visualizerMode = 'idle';
                            this.stopVisualizer();
                            this.stopBufferingDelayTracking();
                            this.hideVisualizer();

                            // Asegurar que llegamos al delay objetivo
                            this.currentDelay = this.targetDelay;
                            this.applyDelay();
                            this.updateDelayDisplay();

                            // ACTIVAR audio con fade-in suave después del buffering
                            if (this.gainNode && this.audioContext) {
                                const targetVolume = this.isMuted ? 0 : this.volume;
                                // Fade-in suave de 100ms para evitar clicks
                                this.gainNode.gain.setTargetAtTime(
                                    targetVolume,
                                    this.audioContext.currentTime,
                                    0.03
                                );
                            }

                            // this.setStatus('🎵 Reproduciendo', 'playing');
                        }
                    }, this.bufferingDuration);
                } else {
                    // this.setStatus('🎵 Reproduciendo (delay no disponible)', 'playing');
                    this.setVisualizerStatus('Delay no disponible');
                }
            };
            
            this.audio.onerror = (e) => {
                // No mostrar error si estamos deteniendo intencionalmente
                if (this.isStopping) return;

                // No detener si estamos pausados
                if (this.isPaused) return;

                // Mostrar error de conexión
                this.currentStreamError = 'No se pudo conectar al stream. Verifica la URL o tu conexión.';
                this.updateErrorDisplay();
                this.setVisualizerStatus('');

                this.stop();
            };

            this.audio.onpause = () => {
                // Solo manejar si NO estamos intencionalmente pausando (no hacer nada por ahora)
            };

            this.audio.onended = () => {
                // No procesar si estamos deteniendo intencionalmente
                if (this.isStopping) return;
                // No detener si estamos pausados
                if (this.isPaused) return;
                this.stop();
            };

            this.audio.onwaiting = () => {
                if (!this.isPaused) {
                    // this.setStatus('Buffering...', 'loading');
                }
            };
            
            this.audio.src = this.currentStreamUrl;
            this.audio.load();
            
            await this.trySetupWebAudio();
            await this.audio.play();
            
        } catch (error) {
            this.isPlaying = false;

            // Mostrar error de reproducción
            this.currentStreamError = 'Error al reproducir: ' + error.message;
            this.updateErrorDisplay();
            this.setVisualizerStatus('');

            this.updateControls();
            this.stop();
        }
    }
    
    pause() {
        if (!this.isPlaying || this.isPaused) return;

        // Track pause action
        if (typeof plausible !== 'undefined') {
            plausible('Pause');
        }

        // Silenciar el audio (NO suspender AudioContext para mantener precisión)
        if (this.gainNode && this.useWebAudio && this.audioContext) {
            this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
        } else if (this.audio) {
            this.audio.muted = true;
        }

        this.stopVisualizer();
        this.setVisualizerStatus('⏸ Pausado');
        this.isPaused = true;
        this.updateControls();
        // this.setStatus('⏸ Pausado - Delay incrementándose...', 'paused');
        this.startPauseDelayTracking();
    }

    resume() {
        if (!this.isPaused) return;

        // Track resume action
        if (typeof plausible !== 'undefined') {
            plausible('Resume');
        }

        // Restaurar el volumen inmediatamente
        if (this.gainNode && this.useWebAudio && this.audioContext) {
            const targetVolume = this.isMuted ? 0 : this.volume;
            this.gainNode.gain.setValueAtTime(targetVolume, this.audioContext.currentTime);
        } else if (this.audio) {
            this.audio.muted = this.isMuted;
        }

        this.isPaused = false;
        this.stopPauseDelayTracking();
        this.updateControls();
        // this.setStatus('🎵 Reproduciendo', 'playing');
        if (this.useWebAudio) {
            this.setVisualizerStatus('');
        } else {
            this.setVisualizerStatus('Delay no disponible');
        }
    }

    startBufferingDelayTracking() {
        this.stopBufferingDelayTracking();

        // Incrementar delay de 0 a targetDelay durante el buffering
        this.bufferingDelayInterval = setInterval(() => {
            if (this.visualizerMode === 'buffering' && this.useWebAudio && !this.isPaused) {
                if (this.currentDelay < this.targetDelay) {
                    this.currentDelay += 100;
                    this.applyDelay();
                    this.updateDelayDisplay();
                }
            }
        }, 100);
    }

    stopBufferingDelayTracking() {
        if (this.bufferingDelayInterval) {
            clearInterval(this.bufferingDelayInterval);
            this.bufferingDelayInterval = null;
        }
    }

    startPauseDelayTracking() {
        this.stopPauseDelayTracking();

        // Incrementar delay cada 100ms mientras está pausado
        this.pauseDelayInterval = setInterval(() => {
            if (this.isPaused && this.useWebAudio) {
                if (this.currentDelay < this.maxDelay) {
                    this.currentDelay += 100;
                    this.applyDelay();
                    this.updateDelayDisplay();

                    // Actualizar mensaje cada segundo
                    if (this.currentDelay % 1000 === 0) {
                        const seconds = (this.currentDelay / 1000).toFixed(0);
                        // this.setStatus(`⏸ Pausado - Delay: ${seconds}s`, 'paused');
                    }
                } else {
                    // this.setStatus('⏸ Pausado - Delay máximo alcanzado (180s)', 'paused');
                }
            }
        }, 100);
    }

    stopPauseDelayTracking() {
        if (this.pauseDelayInterval) {
            clearInterval(this.pauseDelayInterval);
            this.pauseDelayInterval = null;
        }
    }

    async trySetupWebAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.audio.crossOrigin = 'anonymous';
            
            this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

            // Crear filtros de ecualizador
            this.createEQFilters();

            this.delayNode = this.audioContext.createDelay(179.9); // Max ~3 minutos (180 es exclusivo)
            this.delayNode.delayTime.value = Math.max(0, this.currentDelay / 1000);
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.volume; // Configurar volumen inicial

            // Analyser para visualización
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 256; // Waveform suave
            this.analyserNode.smoothingTimeConstant = 0.85; // Suavizado
            this.dataArray = new Uint8Array(this.analyserNode.fftSize);

            // Conectar: source → EQ → delay → analyser → gain → destination
            this.connectAudioChain();

            this.useWebAudio = true;
            
        } catch (error) {
            console.error('Web Audio API falló:', error.name, error.message);
            this.useWebAudio = false;

            if (this.audioContext) {
                this.audioContext.close();
                this.audioContext = null;
            }

            const currentSrc = this.audio.src;
            this.audio = new Audio();
            this.audio.volume = this.volume;
            this.audio.muted = this.isMuted;
            this.audio.src = currentSrc;

            this.audio.onplaying = () => {
                // Si estamos reanudando, solo limpiar el flag y salir
                if (this.isResuming) {
                    this.isResuming = false;
                    return;
                }

                // No actualizar si está pausado
                if (this.isPaused) return;

                this.isPlaying = true;
                this.updateControls();

                // Mostrar mensaje específico según el error
                let errorMsg = '🎵 Reproduciendo...';
                if (error.name === 'SecurityError' || error.message.includes('CORS')) {
                    errorMsg += ' ⚠️ Stream sin CORS - delay y visualizador no disponibles';
                } else {
                    errorMsg += ' (delay y visualizador no disponibles)';
                }
                // this.setStatus(errorMsg, 'playing');
            };

            this.audio.onerror = (e) => {
                // No mostrar error si estamos deteniendo intencionalmente
                if (this.isStopping) return;

                // No detener si estamos pausados
                if (this.isPaused) return;

                // Mostrar error de conexión
                this.currentStreamError = 'No se pudo conectar al stream. Verifica la URL o tu conexión.';
                this.updateErrorDisplay();
                this.setVisualizerStatus('');

                this.stop();
            };

            this.audio.onpause = () => {
                // Solo manejar si NO estamos intencionalmente pausando (no hacer nada por ahora)
            };

            this.audio.onended = () => {
                // No procesar si estamos deteniendo intencionalmente
                if (this.isStopping) return;
                // No detener si estamos pausados
                if (this.isPaused) return;
                this.stop();
            };

            this.audio.onwaiting = () => {
                if (!this.isPaused) {
                    // this.setStatus('Buffering...', 'loading');
                }
            };

            // Ocultar visualizador en modo fallback
            this.hideVisualizer();
        }
    }
    
    stop() {
        // Track stop action
        if (typeof plausible !== 'undefined') {
            plausible('Stop');
        }

        // Marcar que estamos deteniendo intencionalmente
        this.isStopping = true;

        if (this.audio) {
            this.audio.pause();
            this.audio.src = '';
            this.audio = null;
        }

        this.stopVisualizer();
        this.stopCacheTracking();
        this.stopPauseDelayTracking();
        this.stopBufferingDelayTracking();

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
            this.delayNode = null;
            this.sourceNode = null;
            this.gainNode = null;
            this.analyserNode = null;
        }

        this.isPlaying = false;
        this.isPaused = false;
        this.isResuming = false;
        this.useWebAudio = false;
        this.visualizerMode = 'idle';
        this.bufferingStartTime = null;
        this.cacheStartTime = null;
        this.availableCache = 0;

        // Resetear delay a 0
        this.currentDelay = 0;

        // Mostrar visualizador en estado inicial si hay stream seleccionado
        if (this.currentStreamUrl) {
            this.setVisualizerBar(0);
        } else {
            this.hideVisualizer();
        }

        this.updateControls();
        this.updateDelayDisplay(); // Actualizar display del delay
        this.updateErrorDisplay(); // Actualizar display de error
        // this.setStatus('Detenido', 'stopped');
        if (this.currentStreamError) {
            this.setVisualizerStatus('');
        } else {
            this.setVisualizerStatus('Selecciona un stream');
        }

        // Resetear flag después de un breve delay para evitar race conditions
        setTimeout(() => {
            this.isStopping = false;
        }, 100);
    }
    
    // Volume controls
    setVolume(value) {
        this.volume = Math.max(0, Math.min(1, value));

        // Usar GainNode cuando Web Audio está disponible (más rápido y suave)
        if (this.gainNode && this.useWebAudio && this.audioContext) {
            // Transición suave de volumen (sin clics)
            this.gainNode.gain.setTargetAtTime(
                this.volume,
                this.audioContext.currentTime,
                0.01 // Transición muy rápida pero suave
            );
        } else if (this.audio) {
            // Fallback al elemento audio
            this.audio.volume = this.volume;
        }

        if (this.volumeSlider) {
            this.volumeSlider.value = this.volume * 100;
        }
        if (this.volumeValue) {
            this.volumeValue.textContent = Math.round(this.volume * 100) + '%';
        }

        if (this.volume === 0) {
            this.isMuted = true;
        } else if (this.isMuted && this.volume > 0) {
            this.isMuted = false;
            if (this.audio) {
                this.audio.muted = false;
            }
        }

        this.updateMuteButton();
    }
    
    toggleMute() {
        if (this.isMuted) {
            // Unmute
            this.isMuted = false;
            if (this.volume === 0) {
                this.setVolume(this.volumeBeforeMute > 0 ? this.volumeBeforeMute : 0.5);
            } else {
                // Solo necesitamos actualizar el estado del audio element si no usamos Web Audio
                if (!this.useWebAudio && this.audio) {
                    this.audio.muted = false;
                }
                // Con Web Audio, restaurar el volumen con transición suave
                if (this.gainNode && this.useWebAudio && this.audioContext) {
                    this.gainNode.gain.setTargetAtTime(
                        this.volume,
                        this.audioContext.currentTime,
                        0.01
                    );
                }
            }
        } else {
            // Mute
            this.volumeBeforeMute = this.volume;
            this.isMuted = true;

            if (this.gainNode && this.useWebAudio && this.audioContext) {
                // Con Web Audio, poner gain a 0 con transición suave
                this.gainNode.gain.setTargetAtTime(
                    0,
                    this.audioContext.currentTime,
                    0.01
                );
            } else if (this.audio) {
                // Fallback al mute del audio element
                this.audio.muted = true;
            }
        }

        this.updateMuteButton();
    }
    
    updateMuteButton() {
        if (!this.muteBtn) return;

        if (this.isMuted || this.volume === 0) {
            this.muteBtn.textContent = '🔇';
        } else if (this.volume < 0.5) {
            this.muteBtn.textContent = '🔉';
        } else {
            this.muteBtn.textContent = '🔊';
        }
    }
    
    // Delay controls
    adjustDelay(changeMs) {
        if (!this.useWebAudio) return;

        // Track delay adjustment
        if (typeof plausible !== 'undefined') {
            const direction = changeMs > 0 ? 'backward' : 'forward';
            plausible('Delay Adjust', { props: { direction, amount: Math.abs(changeMs) + 'ms' } });
        }

        const newDelay = this.currentDelay + changeMs;

        // Clamp delay: minimum 0ms (live), maximum min(maxDelay, availableCache)
        const maxAllowedDelay = Math.min(this.maxDelay, this.availableCache);
        
        if (newDelay < 0) {
            this.currentDelay = 0;
        } else if (newDelay > maxAllowedDelay) {
            // No podemos ir más allá del cache disponible
            this.currentDelay = maxAllowedDelay;
            
            // Mostrar mensaje temporal si intentamos ir más allá del cache
            if (changeMs > 0 && this.availableCache < this.maxDelay) {
                const cacheSeconds = (this.availableCache / 1000).toFixed(1);
                // this.setStatus(`⏳ Cache: ${cacheSeconds}s - Acumulando...`, 'loading');
                setTimeout(() => {
                    if (this.isPlaying) {
                        // this.setStatus('🎵 Reproduciendo', 'playing');
                    }
                }, 2000);
            }
        } else {
            this.currentDelay = newDelay;
        }

        this.applyDelay();
        this.updateDelayDisplay();
    }
    
    applyDelay() {
        if (this.delayNode && this.audioContext && this.useWebAudio) {
            const actualDelay = Math.max(0, this.currentDelay / 1000);
            
            this.delayNode.delayTime.setTargetAtTime(
                actualDelay,
                this.audioContext.currentTime,
                0.1
            );
        }
    }
    
    setDelayFromSlider(sliderValue) {
        if (!this.useWebAudio) return;

        // Slider invertido: maxDelay = vivo (delay 0), 0 = 3min atrás (delay 180000)
        // Pero limitado al cache disponible
        const maxAllowedDelay = Math.min(this.maxDelay, this.availableCache);
        const requestedDelay = this.maxDelay - sliderValue;
        
        this.currentDelay = Math.min(requestedDelay, maxAllowedDelay);
        this.applyDelay();
        this.updateDelayDisplay();
    }

    goToLive() {
        if (!this.useWebAudio) return;

        // Track go live action
        if (typeof plausible !== 'undefined') {
            plausible('Go Live');
        }

        this.currentDelay = 0;
        this.applyDelay();
        this.updateDelayDisplay();
    }
    
    updateDelayDisplay() {
        const absDelay = Math.abs(this.currentDelay);
        let displayText;

        if (absDelay >= 1000) {
            displayText = (this.currentDelay / 1000).toFixed(1) + ' s';
        } else {
            displayText = this.currentDelay + ' ms';
        }

        if (this.currentDelay > 0) {
            displayText = '+' + displayText;
        }

        this.delayValue.textContent = displayText;

        this.delayValue.classList.remove('negative', 'positive');
        if (this.currentDelay > 0) {
            this.delayValue.classList.add('positive');
        }

        // Update slider position (invertido: maxDelay - delay)
        if (this.delaySlider) {
            this.delaySlider.value = this.maxDelay - this.currentDelay;
        }

        // Update delay buttons state
        this.updateDelayButtons();
    }
    
    updateDelayButtons() {
        const atLive = this.currentDelay === 0;
        const maxAllowedDelay = Math.min(this.maxDelay, this.availableCache);
        const atMax = this.currentDelay >= maxAllowedDelay;

        this.delayButtons.forEach(btn => {
            const delayChange = parseInt(btn.dataset.delay, 10);
            
            if (delayChange < 0) {
                // Botón de adelantar: desactivar si estamos en vivo
                btn.disabled = atLive || !this.isPlaying || !this.useWebAudio;
            } else {
                // Botón de retrasar: desactivar si no hay suficiente cache
                const wouldExceedCache = (this.currentDelay + delayChange) > maxAllowedDelay;
                btn.disabled = wouldExceedCache || !this.isPlaying || !this.useWebAudio;
            }
        });
        
        // Update Go Live button
        if (this.goLiveBtn) {
            this.goLiveBtn.disabled = atLive || !this.isPlaying || !this.useWebAudio;
            if (atLive) {
                this.goLiveBtn.style.opacity = '0.5';
            } else {
                this.goLiveBtn.style.opacity = '1';
            }
        }
    }
    
    updateControls() {
        if (this.playBtn) {
            // El botón play está habilitado cuando:
            // 1. No está reproduciendo y hay un stream seleccionado
            // 2. Está pausado (para reanudar)
            // 3. El stream NO tiene error conocido (CORS, etc.)
            this.playBtn.disabled = (this.isPlaying && !this.isPaused) || !this.currentStreamUrl || this.currentStreamError !== null;

            // Si está deshabilitado por error, hacer más visible la deshabilitación
            if (this.currentStreamError !== null) {
                this.playBtn.style.opacity = '0.2';
                this.playBtn.style.cursor = 'not-allowed';
                this.playBtn.title = 'No disponible: stream con error';
            } else if (this.playBtn.disabled) {
                this.playBtn.style.opacity = '';
                this.playBtn.style.cursor = '';
            } else {
                this.playBtn.style.opacity = '';
                this.playBtn.style.cursor = '';
            }

            // Cambiar icono según el estado
            if (this.isPaused) {
                this.playBtn.textContent = '▶';
                this.playBtn.title = 'Reanudar';
            } else if (this.currentStreamError === null) {
                this.playBtn.textContent = '▶';
                this.playBtn.title = 'Reproducir';
            }
        }
        if (this.pauseBtn) {
            this.pauseBtn.disabled = !this.isPlaying || this.isPaused;
        }
        if (this.stopBtn) {
            this.stopBtn.disabled = !this.isPlaying;
        }
        if (this.streamSelector) {
            this.streamSelector.disabled = this.isPlaying;
        }

        // Enable/disable delay slider
        if (this.delaySlider) {
            this.delaySlider.disabled = !this.isPlaying || !this.useWebAudio;
        }

        // Update delay buttons state
        this.updateDelayButtons();
    }
    
    // setStatus() - Método eliminado (indicador de estado removido)
    // setStatus(message, statusClass) {
    //     this.statusEl.textContent = message;
    //     this.statusEl.className = 'status';
    //     if (statusClass) {
    //         this.statusEl.classList.add(statusClass);
    //     }
    // }

    // Visualizer - Solo barra de progreso durante buffering
    startVisualizer() {
        this.stopVisualizer();

        this.visualizerInterval = setInterval(() => {
            if (!this.isPlaying) return;

            // Solo mostrar progreso de buffering
            if (this.visualizerMode === 'buffering' && this.bufferingStartTime) {
                const progress = Math.min((Date.now() - this.bufferingStartTime) / this.bufferingDuration, 1);
                this.setVisualizerBar(progress * 100);
            }
        }, 50);
    }

    stopVisualizer() {
        if (this.visualizerInterval) {
            clearInterval(this.visualizerInterval);
            this.visualizerInterval = null;
        }
    }
    
    startCacheTracking() {
        this.stopCacheTracking();

        // Actualizar cache disponible cada 500ms
        this.cacheUpdateInterval = setInterval(() => {
            if (this.cacheStartTime && this.isPlaying && !this.isPaused) {
                const elapsed = Date.now() - this.cacheStartTime;
                // El cache disponible es el tiempo transcurrido, limitado al máximo
                this.availableCache = Math.min(elapsed, this.maxDelay);

                // Actualizar botones por si ahora hay más cache disponible
                this.updateDelayButtons();
            }
        }, 500);
    }
    
    stopCacheTracking() {
        if (this.cacheUpdateInterval) {
            clearInterval(this.cacheUpdateInterval);
            this.cacheUpdateInterval = null;
        }
    }

    // ==================== EQUALIZER ====================

    setupEQBands() {
        // Detectar cuántas bandas hay en el DOM
        const sliders = document.querySelectorAll('[data-eq-band]');
        const numBands = sliders.length;

        // Configuraciones de EQ según número de bandas
        const eqConfigs = {
            7: [ // 7 bandas - Estándar (index.html)
                { freq: 60, type: 'lowshelf', label: '60Hz' },
                { freq: 170, type: 'peaking', label: '170Hz' },
                { freq: 310, type: 'peaking', label: '310Hz' },
                { freq: 600, type: 'peaking', label: '600Hz' },
                { freq: 1000, type: 'peaking', label: '1kHz' },
                { freq: 3000, type: 'peaking', label: '3kHz' },
                { freq: 14000, type: 'highshelf', label: '14kHz' }
            ],
            10: [ // 10 bandas - WinAmp (winamp.html)
                { freq: 60, type: 'lowshelf', label: '60' },
                { freq: 170, type: 'peaking', label: '170' },
                { freq: 310, type: 'peaking', label: '310' },
                { freq: 600, type: 'peaking', label: '600' },
                { freq: 1000, type: 'peaking', label: '1K' },
                { freq: 3000, type: 'peaking', label: '3K' },
                { freq: 6000, type: 'peaking', label: '6K' },
                { freq: 12000, type: 'peaking', label: '12K' },
                { freq: 14000, type: 'peaking', label: '14K' },
                { freq: 16000, type: 'highshelf', label: '16K' }
            ]
        };

        this.eqBands = eqConfigs[numBands] || [];
    }

    initEqualizer() {
        // Buscar sliders de EQ en el DOM
        this.eqSliders = [];
        this.eqBands.forEach((band, i) => {
            const slider = document.querySelector(`[data-eq-band="${i}"]`);
            if (slider) {
                this.eqSliders.push(slider);
                slider.addEventListener('input', (e) => {
                    this.updateEQBand(i, parseFloat(e.target.value));
                });
            }
        });
    }

    createEQFilters() {
        if (!this.audioContext) return;

        // Crear filtros biquad para cada banda
        this.eqFilters = this.eqBands.map(band => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.freq;
            filter.Q.value = 1.0; // Ancho de banda estándar
            filter.gain.value = 0; // Sin ganancia por defecto
            return filter;
        });
    }

    connectAudioChain() {
        if (!this.sourceNode || this.eqFilters.length === 0) return;

        // Conectar: source → eq[0] → eq[1] → ... → eq[9] → delay → analyser → gain → destination
        this.sourceNode.connect(this.eqFilters[0]);

        // Conectar filtros en cadena
        for (let i = 0; i < this.eqFilters.length - 1; i++) {
            this.eqFilters[i].connect(this.eqFilters[i + 1]);
        }

        // Conectar último filtro al resto de la cadena
        this.eqFilters[this.eqFilters.length - 1].connect(this.delayNode);
        this.delayNode.connect(this.analyserNode);
        this.analyserNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
    }

    updateEQBand(bandIndex, gainDB) {
        if (this.eqFilters[bandIndex]) {
            this.eqFilters[bandIndex].gain.value = gainDB;
        }

        // Guardar preset automáticamente
        this.saveEQPreset(this.currentStreamUrl);
    }

    resetEqualizer() {
        this.eqSliders.forEach((slider, i) => {
            slider.value = 0;
            if (this.eqFilters[i]) {
                this.eqFilters[i].gain.value = 0;
            }
        });

        // Guardar preset reseteado
        this.saveEQPreset(this.currentStreamUrl);
    }

    toggleEqualizer() {
        const eqPanel = document.getElementById('eq-panel');
        const eqToggleBtn = document.getElementById('eq-toggle-btn');

        if (eqPanel && eqToggleBtn) {
            const isHidden = eqPanel.style.display === 'none';

            eqPanel.style.display = isHidden ? 'block' : 'none';

            // Detectar si es versión WinAmp o normal por el contenido del botón
            if (eqToggleBtn.textContent.includes('HIDE') || eqToggleBtn.textContent.includes('SHOW')) {
                // Versión WinAmp
                eqToggleBtn.textContent = isHidden ? 'HIDE' : 'SHOW';
            } else {
                // Versión normal
                eqToggleBtn.textContent = isHidden ? '🎚 Ocultar EQ' : '🎚 Mostrar EQ';
            }
        }
    }

    saveEQPreset(streamUrl) {
        if (!streamUrl) return;

        const preset = this.eqSliders.map(slider => parseFloat(slider.value));
        const presets = JSON.parse(localStorage.getItem('radioEQPresets') || '{}');
        presets[streamUrl] = preset;
        localStorage.setItem('radioEQPresets', JSON.stringify(presets));
    }

    loadEQPreset(streamUrl) {
        if (!streamUrl) return;

        const presets = JSON.parse(localStorage.getItem('radioEQPresets') || '{}');
        const preset = presets[streamUrl];

        if (preset && Array.isArray(preset)) {
            this.eqSliders.forEach((slider, i) => {
                if (preset[i] !== undefined) {
                    slider.value = preset[i];
                    if (this.eqFilters[i]) {
                        this.eqFilters[i].gain.value = preset[i];
                    }
                }
            });
        } else {
            // Sin preset guardado, resetear a 0
            this.resetEqualizer();
        }
    }

    // ==================== CUSTOM STREAMS ====================

    loadCustomStreams() {
        try {
            const stored = localStorage.getItem('customRadioStreams');
            this.customStreams = stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error loading custom streams:', error);
            this.customStreams = [];
        }
    }

    saveCustomStreams() {
        try {
            localStorage.setItem('customRadioStreams', JSON.stringify(this.customStreams));
        } catch (error) {
            console.error('Error saving custom streams:', error);
        }
    }

    addCustomStream() {
        const name = this.customStreamName.value.trim();
        const url = this.customStreamUrl.value.trim();

        if (!name || !url) {
            alert('Por favor, ingresa un nombre y una URL para el stream.');
            return;
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch (error) {
            alert('La URL ingresada no es válida. Por favor, verifica e intenta nuevamente.');
            return;
        }

        // Check if URL already exists
        const exists = this.customStreams.some(stream => stream.url === url) ||
                      this.officialStreams.some(stream => stream.url === url);

        if (exists) {
            alert('Este stream ya existe en tu lista.');
            return;
        }

        // Add to custom streams
        this.customStreams.push({ name, url });
        this.saveCustomStreams();
        this.updateStreamSelector();
        this.renderCustomStreamsList();

        // Track custom stream addition
        if (typeof plausible !== 'undefined') {
            plausible(
                'Custom Stream Added',
                { props: {
                    stream_name: name,
                    stream_url: url
                } }
            );
        }

        // Clear input fields
        this.customStreamName.value = '';
        this.customStreamUrl.value = '';

        // Focus on name input for next entry
        this.customStreamName.focus();
    }

    deleteCustomStream(index) {
        const stream = this.customStreams[index];

        if (!confirm(`¿Estás seguro de que quieres eliminar "${stream.name}"?`)) {
            return;
        }

        // If the deleted stream is currently selected, clear the selection
        if (this.currentStreamUrl === stream.url) {
            this.stop();
            this.streamSelector.value = '';
            this.currentStreamUrl = '';
        }

        this.customStreams.splice(index, 1);
        this.saveCustomStreams();
        this.updateStreamSelector();
        this.renderCustomStreamsList();
    }

    updateStreamSelector() {
        // Clear all options except the first one (placeholder)
        while (this.streamSelector.options.length > 1) {
            this.streamSelector.remove(1);
        }

        // Add official streams
        this.officialStreams.forEach(stream => {
            const option = document.createElement('option');
            option.value = stream.url;
            option.textContent = stream.name;
            this.streamSelector.appendChild(option);
        });

        // Add custom streams with a visual indicator
        this.customStreams.forEach(stream => {
            const option = document.createElement('option');
            option.value = stream.url;
            option.textContent = `🎧 ${stream.name}`;
            this.streamSelector.appendChild(option);
        });
    }

    renderCustomStreamsList() {
        if (!this.customStreamsList) return;

        // Clear existing items
        this.customStreamsList.innerHTML = '';

        // Detect if we're in WinAmp style (check for winamp-specific classes in document)
        const isWinAmpStyle = document.querySelector('.winamp-container') !== null;

        if (this.customStreams.length === 0) {
            if (isWinAmpStyle) {
                this.customStreamsList.innerHTML = '<p style="color: #00ff00; font-size: 10px; text-align: center; padding: 8px;">NO CUSTOM STREAMS YET</p>';
            } else {
                this.customStreamsList.innerHTML = '<p style="color: #71717a; font-size: 0.85rem; text-align: center; padding: 12px;">No hay streams personalizados aún.</p>';
            }
            return;
        }

        // Render each custom stream
        this.customStreams.forEach((stream, index) => {
            const item = document.createElement('div');

            if (isWinAmpStyle) {
                // WinAmp style
                item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #000; border: 1px solid #333; margin-bottom: 4px;';

                const info = document.createElement('div');
                info.style.cssText = 'flex: 1; min-width: 0;';

                const name = document.createElement('div');
                name.style.cssText = 'font-size: 11px; font-weight: bold; color: #00ff00; margin-bottom: 2px; font-family: "Courier New", monospace;';
                name.textContent = stream.name;

                const url = document.createElement('div');
                url.style.cssText = 'font-size: 9px; color: #00aa00; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Courier New", monospace;';
                url.textContent = stream.url;
                url.title = stream.url;

                info.appendChild(name);
                info.appendChild(url);

                const deleteBtn = document.createElement('button');
                deleteBtn.style.cssText = 'padding: 4px 8px; background: linear-gradient(180deg, #ff6060 0%, #cc4040 100%); border: 2px outset #ff7070; color: #fff; font-size: 9px; font-family: "Courier New", monospace; cursor: pointer; margin-left: 8px; flex-shrink: 0;';
                deleteBtn.textContent = 'DEL';
                deleteBtn.addEventListener('click', () => {
                    this.deleteCustomStream(index);
                });

                item.appendChild(info);
                item.appendChild(deleteBtn);
            } else {
                // Modern style
                item.className = 'custom-stream-item';

                const info = document.createElement('div');
                info.className = 'custom-stream-info';

                const name = document.createElement('div');
                name.className = 'custom-stream-name';
                name.textContent = stream.name;

                const url = document.createElement('div');
                url.className = 'custom-stream-url';
                url.textContent = stream.url;
                url.title = stream.url;

                info.appendChild(name);
                info.appendChild(url);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn-delete-stream';
                deleteBtn.textContent = 'Eliminar';
                deleteBtn.addEventListener('click', () => {
                    this.deleteCustomStream(index);
                });

                item.appendChild(info);
                item.appendChild(deleteBtn);
            }

            this.customStreamsList.appendChild(item);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.radioPlayer = new RadioPlayer();
});
