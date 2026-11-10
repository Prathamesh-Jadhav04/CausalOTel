package com.causalotel.payment;

import com.causalotel.payment.config.PaymentSimulationSafetyPostProcessor;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class PaymentSimulationSafetyTest {

    private final PaymentSimulationSafetyPostProcessor postProcessor = new PaymentSimulationSafetyPostProcessor();
    private final SpringApplication application = new SpringApplication();

    @Test
    @DisplayName("Default environment with simulation enabled allows startup")
    void testDefaultProfileAllowsSimulation() {
        StandardEnvironment env = new StandardEnvironment();
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "true"
        )));

        assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(env, application));
    }

    @Test
    @DisplayName("Dev profile with simulation enabled allows startup")
    void testDevProfileAllowsSimulation() {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles("dev");
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "true"
        )));

        assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(env, application));
    }

    @Test
    @DisplayName("Prod profile with simulation enabled fails closed and throws IllegalStateException")
    void testProdProfileWithSimulationThrowsException() {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles("prod");
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "true"
        )));

        IllegalStateException ex = assertThrows(IllegalStateException.class, () ->
                postProcessor.postProcessEnvironment(env, application)
        );
        assertTrue(ex.getMessage().contains("CRITICAL SAFETY VIOLATION"),
                "Exception message should mention CRITICAL SAFETY VIOLATION");
    }

    @Test
    @DisplayName("Production profile with simulation enabled fails closed")
    void testProductionProfileWithSimulationThrowsException() {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles("production");
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "true"
        )));

        IllegalStateException ex = assertThrows(IllegalStateException.class, () ->
                postProcessor.postProcessEnvironment(env, application)
        );
        assertTrue(ex.getMessage().contains("CRITICAL SAFETY VIOLATION"));
    }

    @Test
    @DisplayName("Prod profile with simulation explicitly disabled allows startup")
    void testProdProfileWithSimulationDisabledAllowsStartup() {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles("prod");
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "false"
        )));

        assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(env, application));
    }

    @Test
    @DisplayName("Multi-profile dev and prod with simulation enabled fails closed")
    void testMultiProfileDevAndProdThrowsException() {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles("dev", "prod");
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", "true"
        )));

        assertThrows(IllegalStateException.class, () ->
                postProcessor.postProcessEnvironment(env, application)
        );
    }
}
