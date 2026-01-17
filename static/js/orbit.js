export class OrbitControls {
    constructor({ container, pivot, sensitivity = 0.5, initialX = -20, initialY = 45 }) {
        this.container = document.querySelector(container);
        this.pivot = document.querySelector(pivot);
        
        // Configuration
        this.sensitivity = sensitivity;
        
        // State
        this.rotX = initialX;
        this.rotY = initialY;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;

        // Bind methods
        this.start = this.start.bind(this);
        this.move = this.move.bind(this);
        this.end = this.end.bind(this);

        this.init();
    }

    init() {
        // Mouse Events
        this.container.addEventListener('mousedown', this.start);
        window.addEventListener('mousemove', this.move);
        window.addEventListener('mouseup', this.end);

        // Touch Events (Mobile)
        this.container.addEventListener('touchstart', this.start, { passive: false });
        window.addEventListener('touchmove', this.move, { passive: false });
        window.addEventListener('touchend', this.end);

        // Set initial position
        this.updateTransform();
    }

    start(e) {
        if(e.type === 'touchstart') e.preventDefault(); // Stop mobile scroll

        this.isDragging = true;
        this.container.style.cursor = 'grabbing';
        
        const point = e.touches ? e.touches[0] : e;
        this.startX = point.clientX;
        this.startY = point.clientY;
    }

    move(e) {
        if (!this.isDragging) return;
        if(e.type === 'touchmove') e.preventDefault();

        const point = e.touches ? e.touches[0] : e;
        const deltaX = point.clientX - this.startX;
        const deltaY = point.clientY - this.startY;

        // Update rotation (X = pitch, Y = yaw)
        this.rotY += deltaX * this.sensitivity;
        this.rotX -= deltaY * this.sensitivity;

        // Clamp Vertical Rotation (Prevent flipping upside down)
        this.rotX = Math.max(-90, Math.min(90, this.rotX));

        this.updateTransform();

        this.startX = point.clientX;
        this.startY = point.clientY;
    }

    end() {
        this.isDragging = false;
        this.container.style.cursor = 'grab';
    }

    updateTransform() {
        this.pivot.style.transform = `rotateX(${this.rotX}deg) rotateY(${this.rotY}deg)`;
    }
}