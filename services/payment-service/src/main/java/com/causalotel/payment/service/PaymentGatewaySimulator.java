package com.causalotel.payment.service;

import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@Service
public class PaymentGatewaySimulator {

    public enum FaultMode {
        NORMAL,
        LATENCY,
        DECLINED,
        GATEWAY_TIMEOUT,
        GATEWAY_DOWN
    }

    private final AtomicInteger latencyMs = new AtomicInteger(0);
    private final AtomicReference<FaultMode> faultMode = new AtomicReference<>(FaultMode.NORMAL);
    private final AtomicReference<String> customErrorMessage = new AtomicReference<>(null);

    /**
     * H-01: fault state must not survive a restart, otherwise an earlier
     * injected failure silently degrades a fresh process.
     */
    @PostConstruct
    public void resetOnStartup() {
        reset();
    }

    public int getLatencyMs() {
        return latencyMs.get();
    }

    public void setLatencyMs(int ms) {
        this.latencyMs.set(Math.max(0, ms));
    }

    public FaultMode getFaultMode() {
        return faultMode.get();
    }

    public void setFaultMode(FaultMode mode) {
        this.faultMode.set(mode != null ? mode : FaultMode.NORMAL);
    }

    public String getCustomErrorMessage() {
        return customErrorMessage.get();
    }

    public void setCustomErrorMessage(String msg) {
        this.customErrorMessage.set(msg);
    }

    public void reset() {
        this.latencyMs.set(0);
        this.faultMode.set(FaultMode.NORMAL);
        this.customErrorMessage.set(null);
    }

    public void applySimulation() throws InterruptedException {
        int delay = latencyMs.get();
        if (delay > 0) {
            Thread.sleep(delay);
        }

        FaultMode mode = faultMode.get();
        switch (mode) {
            case LATENCY -> {
                // Delay already applied if latencyMs > 0, otherwise default delay
                if (delay <= 0) {
                    Thread.sleep(3000);
                }
            }
            case DECLINED -> throw new PaymentDeclinedException(
                    customErrorMessage.get() != null ? customErrorMessage.get() : "Card declined by payment processor (simulated)"
            );
            case GATEWAY_TIMEOUT -> throw new GatewayTimeoutException(
                    customErrorMessage.get() != null ? customErrorMessage.get() : "Simulated downstream payment gateway timeout (504)"
            );
            case GATEWAY_DOWN -> throw new GatewayDownException(
                    customErrorMessage.get() != null ? customErrorMessage.get() : "Simulated downstream payment gateway service unavailable (503)"
            );
            case NORMAL -> {
                // No simulated error
            }
        }
    }

    public static class PaymentDeclinedException extends RuntimeException {
        public PaymentDeclinedException(String message) {
            super(message);
        }
    }

    public static class GatewayTimeoutException extends RuntimeException {
        public GatewayTimeoutException(String message) {
            super(message);
        }
    }

    public static class GatewayDownException extends RuntimeException {
        public GatewayDownException(String message) {
            super(message);
        }
    }
}
