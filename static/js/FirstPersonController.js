export class FirstPersonController {
    constructor(config = {}) {
        this.speed = config.speed || 15;
        this.sensitivity = config.sensitivity || 0.1;
        this.touchSensitivity = config.touchSensitivity || 0.25; // Lower is usually better for touch
        this.eyeHeight = config.eyeHeight || 170; 

        // Physics State
        this.pos = { x: 0, y: 0, z: 0 }; 
        this.rot = { yaw: 0, pitch: 0 };
        this.velZ = 0; 

        // Input State
        this.keys = { w:false, a:false, s:false, d:false, space:false };
        
        // Mobile Input State
        this.touchMove = { 
            active: false, 
            id: null, 
            startX: 0, startY: 0, 
            currX: 0, currY: 0, 
            vectorX: 0, vectorY: 0 
        };
        this.touchLook = { 
            active: false, 
            id: null, 
            lastX: 0, lastY: 0 
        };

        // DOM Elements
        this.worldElement = document.querySelector('.fpc-world');
        this.gridElement = document.querySelector('.primitive-grid');
        this.fpsElement = document.getElementById('fps-counter');
        
        // Mobile UI Elements
        this.knobElement = document.querySelector('.joystick-knob');
        this.jumpBtn = document.getElementById('btn-jump');

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
            // Only lock pointer if we are NOT clicking UI buttons (like Jump)
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
        // Passive: false is crucial to prevent scrolling while dragging
        document.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        document.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        document.addEventListener('touchend', this.handleTouchEnd);

        // Mobile Jump Button
        if(this.jumpBtn) {
            this.jumpBtn.addEventListener('touchstart', (e) => {
                e.preventDefault(); // Prevent ghost mouse clicks
                this.keys.space = true;
            });
            this.jumpBtn.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.keys.space = false;
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

    // --- Mobile Logic ---

    handleTouchStart = (e) => {
        // Ignore touches on the jump button (handled separately)
        if(e.target.closest('.mobile-jump-btn')) return;

        e.preventDefault();
        
        const halfScreen = window.innerWidth / 2;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // Left Side = Movement (Joystick)
            if (t.clientX < halfScreen && !this.touchMove.active) {
                this.touchMove.active = true;
                this.touchMove.id = t.identifier;
                this.touchMove.startX = t.clientX;
                this.touchMove.startY = t.clientY;
                this.touchMove.currX = t.clientX;
                this.touchMove.currY = t.clientY;
                this.touchMove.vectorX = 0;
                this.touchMove.vectorY = 0;

                // Show visual knob at touch point
                if(this.knobElement) {
                    this.knobElement.style.display = 'block';
                    this.knobElement.style.top = t.clientY + 'px';
                    this.knobElement.style.left = t.clientX + 'px';
                    this.knobElement.style.transform = `translate(-50%, -50%)`;
                }
            }
            // Right Side = Look (Touchpad)
            else if (t.clientX >= halfScreen && !this.touchLook.active) {
                this.touchLook.active = true;
                this.touchLook.id = t.identifier;
                this.touchLook.lastX = t.clientX;
                this.touchLook.lastY = t.clientY;
            }
        }
    }

    handleTouchMove = (e) => {
        e.preventDefault();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // 1. Update Joystick
            if (this.touchMove.active && t.identifier === this.touchMove.id) {
                this.touchMove.currX = t.clientX;
                this.touchMove.currY = t.clientY;

                const maxRadius = 50; // px
                let dx = t.clientX - this.touchMove.startX;
                let dy = t.clientY - this.touchMove.startY;
                
                // Clamp distance to maxRadius for the visual
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > maxRadius) {
                    const ratio = maxRadius / dist;
                    dx *= ratio;
                    dy *= ratio;
                }

                // Update Input Vector (-1 to 1)
                this.touchMove.vectorX = dx / maxRadius;
                this.touchMove.vectorY = dy / maxRadius;

                // Move knob visually
                if(this.knobElement) {
                    this.knobElement.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                }
            }

            // 2. Update Look
            if (this.touchLook.active && t.identifier === this.touchLook.id) {
                const dx = t.clientX - this.touchLook.lastX;
                const dy = t.clientY - this.touchLook.lastY;

                this.rot.yaw += dx * this.touchSensitivity;
                this.rot.pitch -= dy * this.touchSensitivity;
                this.clampPitch();

                this.touchLook.lastX = t.clientX;
                this.touchLook.lastY = t.clientY;
            }
        }
    }

    handleTouchEnd = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // Reset Joystick
            if (this.touchMove.active && t.identifier === this.touchMove.id) {
                this.touchMove.active = false;
                this.touchMove.id = null;
                this.touchMove.vectorX = 0;
                this.touchMove.vectorY = 0;
                if(this.knobElement) this.knobElement.style.display = 'none';
            }

            // Reset Look
            if (this.touchLook.active && t.identifier === this.touchLook.id) {
                this.touchLook.active = false;
                this.touchLook.id = null;
            }
        }
    }

    // --- Main Loop ---

    loop = () => {
        const rad = this.rot.yaw * (Math.PI / 180);
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);
        
        // 1. Combine Inputs (Keys + Touch)
        let forward = 0; // -1 to 1
        let strafe = 0;  // -1 to 1

        // Keyboard
        if (this.keys.w) forward += 1;
        if (this.keys.s) forward -= 1;
        if (this.keys.d) strafe += 1;
        if (this.keys.a) strafe -= 1;

        // Joystick (Vertical axis is inverted: Negative Y is Forward on screen)
        if (this.touchMove.active) {
            strafe += this.touchMove.vectorX;
            forward -= this.touchMove.vectorY; 
        }

        // Clamp combined input to length 1 (prevents super-speed if using both)
        const len = Math.sqrt(forward*forward + strafe*strafe);
        if (len > 1) {
            forward /= len;
            strafe /= len;
        }

        // 2. Apply Movement relative to Camera Angle
        if (Math.abs(forward) > 0 || Math.abs(strafe) > 0) {
            // Forward moves along sin/cos
            // Strafe moves along cos/sin (90 deg offset)
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

            // Grid Snapping
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