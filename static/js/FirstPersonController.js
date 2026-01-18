export class FirstPersonController {
    constructor(config = {}) {
        this.speed = config.speed || 15;
        this.sensitivity = config.sensitivity || 0.1; // Mouse
        this.lookSpeed = config.lookSpeed || 2.5;     // Touch Joystick
        this.eyeHeight = config.eyeHeight || 170; 

        // Physics State
        this.pos = { x: 0, y: 0, z: 0 }; 
        this.rot = { yaw: 0, pitch: 0 };
        this.velZ = 0; 

        // Input State
        this.keys = { w:false, a:false, s:false, d:false, space:false };
        
        // Mobile Sticks (Symmetrical Logic)
        this.stickLeft = { 
            active: false, id: null, 
            startX: 0, startY: 0, 
            vectorX: 0, vectorY: 0 
        };
        this.stickRight = { 
            active: false, id: null, 
            startX: 0, startY: 0, 
            vectorX: 0, vectorY: 0 
        };

        // DOM Elements
        this.worldElement = document.querySelector('.fpc-world');
        this.gridElement = document.querySelector('.primitive-grid');
        this.fpsElement = document.getElementById('fps-counter');
        
        // UI Elements
        this.knobLeft = document.getElementById('knob-move');
        this.knobRight = document.getElementById('knob-look');
        this.jumpBtn = document.getElementById('btn-jump');
        this.fsBtn = document.getElementById('btn-fullscreen');

        this.lastTime = performance.now();
        this.frameCount = 0;

        this.init();
        this.loop();
    }

    init() {
        // --- Desktop Inputs ---
        window.addEventListener('keydown', e => this.key(e.code, true));
        window.addEventListener('keyup', e => this.key(e.code, false));
        
        document.body.addEventListener('click', (e) => {
            // Lock pointer only if we didn't click a UI button
            if(e.target.tagName !== 'BUTTON' && !e.target.closest('.mobile-jump-btn')) {
                document.body.requestPointerLock();
            }
        });
        
        document.addEventListener('mousemove', e => {
            if(document.pointerLockElement === document.body) {
                this.rot.yaw += e.movementX * this.sensitivity; 
                this.rot.pitch -= e.movementY * this.sensitivity;
                this.clampPitch();
            }
        });

        // --- Mobile Inputs ---
        // passive: false is required to prevent browser scrolling
        document.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        document.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        document.addEventListener('touchend', this.handleTouchEnd);

        // Jump Button
        if(this.jumpBtn) {
            this.jumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault(); 
                this.keys.space = true;
            });
            this.jumpBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.keys.space = false;
            });
        }

        // Fullscreen Toggle
        if(this.fsBtn) {
            this.fsBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(err => {
                        console.warn("Fullscreen blocked:", err);
                    });
                } else {
                    document.exitFullscreen();
                }
            });

            // Update Text
            document.addEventListener('fullscreenchange', () => {
                if (document.fullscreenElement) {
                    this.fsBtn.textContent = "Exit Fullscreen";
                } else {
                    this.fsBtn.textContent = "Go Fullscreen";
                }
            });
        }
    }

    key(code, state) {
        if(code == 'KeyW') this.keys.w = state;
        if(code == 'KeyS') this.keys.s = state;
        if(code == 'KeyA') this.keys.a = state;
        if(code == 'KeyD') this.keys.d = state;
        if(code == 'Space') this.keys.space = state;
    }

    clampPitch() {
        this.rot.pitch = Math.max(-89, Math.min(89, this.rot.pitch));
    }

    // --- Stick Logic Helper ---
    
    updateStickStart(stick, touch, knobElement) {
        stick.active = true;
        stick.id = touch.identifier;
        stick.startX = touch.clientX;
        stick.startY = touch.clientY;
        stick.vectorX = 0;
        stick.vectorY = 0;

        if(knobElement) {
            knobElement.style.display = 'block';
            knobElement.style.left = touch.clientX + 'px';
            knobElement.style.top = touch.clientY + 'px';
            knobElement.style.transform = `translate(-50%, -50%)`;
        }
    }

    updateStickMove(stick, touch, knobElement) {
        const maxRadius = 40; // Joystick range in px
        let dx = touch.clientX - stick.startX;
        let dy = touch.clientY - stick.startY;
        
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > maxRadius) {
            const ratio = maxRadius / dist;
            dx *= ratio;
            dy *= ratio;
        }

        // Normalize -1 to 1
        stick.vectorX = dx / maxRadius;
        stick.vectorY = dy / maxRadius;

        if(knobElement) {
            knobElement.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }
    }

    resetStick(stick, knobElement) {
        stick.active = false;
        stick.id = null;
        stick.vectorX = 0;
        stick.vectorY = 0;
        if(knobElement) knobElement.style.display = 'none';
    }

    // --- Touch Handlers ---

    handleTouchStart = (e) => {
        // Don't capture touches intended for buttons
        if(e.target.tagName === 'BUTTON' || e.target.closest('.mobile-jump-btn')) return;
        
        e.preventDefault();
        const halfScreen = window.innerWidth / 2;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // Left Side: Move Stick
            if (t.clientX < halfScreen && !this.stickLeft.active) {
                this.updateStickStart(this.stickLeft, t, this.knobLeft);
            }
            // Right Side: Look Stick
            else if (t.clientX >= halfScreen && !this.stickRight.active) {
                this.updateStickStart(this.stickRight, t, this.knobRight);
            }
        }
    }

    handleTouchMove = (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            
            if (this.stickLeft.active && t.identifier === this.stickLeft.id) {
                this.updateStickMove(this.stickLeft, t, this.knobLeft);
            }
            if (this.stickRight.active && t.identifier === this.stickRight.id) {
                this.updateStickMove(this.stickRight, t, this.knobRight);
            }
        }
    }

    handleTouchEnd = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            
            if (this.stickLeft.active && t.identifier === this.stickLeft.id) {
                this.resetStick(this.stickLeft, this.knobLeft);
            }
            if (this.stickRight.active && t.identifier === this.stickRight.id) {
                this.resetStick(this.stickRight, this.knobRight);
            }
        }
    }

    // --- Main Loop ---

    loop = () => {
        const rad = this.rot.yaw * (Math.PI / 180);
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        
        // 1. LOOK (Right Joystick)
        if (this.stickRight.active) {
            this.rot.yaw += this.stickRight.vectorX * this.lookSpeed;
            this.rot.pitch -= this.stickRight.vectorY * this.lookSpeed;
            this.clampPitch();
        }

        // 2. MOVE (Left Joystick + Keys)
        let forward = 0;
        let strafe = 0;

        // Keys
        if (this.keys.w) forward += 1;
        if (this.keys.s) forward -= 1;
        if (this.keys.d) strafe += 1;
        if (this.keys.a) strafe -= 1;

        // Joystick (Y is inverted on screen)
        if (this.stickLeft.active) {
            strafe += this.stickLeft.vectorX;
            forward -= this.stickLeft.vectorY; 
        }

        // Clamp combined input
        const len = Math.sqrt(forward*forward + strafe*strafe);
        if (len > 1) {
            forward /= len;
            strafe /= len;
        }

        // Apply
        if (Math.abs(forward) > 0 || Math.abs(strafe) > 0) {
            const dx = (strafe * cos) + (forward * sin);
            const dy = (strafe * sin) - (forward * cos);
            this.pos.x += dx * this.speed;
            this.pos.y += dy * this.speed;
        }

        // 3. Gravity
        if(this.pos.z === 0 && this.keys.space) this.velZ = 25;
        this.pos.z += this.velZ;
        if(this.pos.z > 0) this.velZ -= 1.2;
        if(this.pos.z < 0) { this.pos.z = 0; this.velZ = 0; }

        // 4. Render
        if (this.worldElement) {
            const r = this.worldElement.style;
            
            r.setProperty('--p-x', `${this.pos.x.toFixed(1)}px`);
            r.setProperty('--p-y', `${this.pos.y.toFixed(1)}px`);
            r.setProperty('--p-z', `${(this.pos.z + this.eyeHeight).toFixed(1)}px`);
            
            r.setProperty('--yaw', `${this.rot.yaw.toFixed(1)}deg`);
            r.setProperty('--pitch', `${this.rot.pitch.toFixed(1)}deg`);

            if (this.gridElement) {
                const gridSize = 100;
                const snapX = Math.round(this.pos.x / gridSize) * gridSize;
                const snapY = Math.round(this.pos.y / gridSize) * gridSize;
                this.gridElement.style.setProperty('--grid-x', `${snapX}px`);
                this.gridElement.style.setProperty('--grid-y', `${snapY}px`);
            }
        }

        this.frameCount++;
        const now = performance.now();
        if (now - this.lastTime >= 1000) {
            if (this.fpsElement) this.fpsElement.innerText = `FPS: ${this.frameCount}`;
            this.frameCount = 0;
            this.lastTime = now;
        }

        requestAnimationFrame(this.loop);
    }
}