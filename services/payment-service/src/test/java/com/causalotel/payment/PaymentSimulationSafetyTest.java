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

    private StandardEnvironment environment(String enabled, String... profiles) {
        StandardEnvironment env = new StandardEnvironment();
        env.setActiveProfiles(profiles);
        env.getPropertySources().addFirst(new MapPropertySource("test", Map.of(
                "causalotel.payment.simulation.enabled", enabled
        )));
        return env;
    }

    @Test
    @DisplayName("L-02: simulation defaults to disabled when the property is absent")
    void testSimulationDisabledByDefault() {
        StandardEnvironment env = new StandardEnvironment();
        assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(env, application));
    }

    @Test
    @DisplayName("L-02: enabling simulation without an explicit demo/dev/test profile fails closed")
    void testSimulationRequiresExplicitProfile() {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> postProcessor.postProcessEnvironment(environment("true"), application));
        assertTrue(ex.getMessage().contains("no demo/dev/test profile"));
    }

    @Test
    @DisplayName("L-02: demo, dev, and test profiles allow simulation")
    void testSimulationProfilesAllowStartup() {
        for (String profile : new String[]{"demo", "dev", "test"}) {
            assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(environment("true", profile), application),
                    "profile " + profile + " should permit explicit simulation");
        }
    }

    @Test
    @DisplayName("L-02: prod profile with simulation enabled fails closed")
    void testProdProfileWithSimulationThrowsException() {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> postProcessor.postProcessEnvironment(environment("true", "prod"), application));
        assertTrue(ex.getMessage().contains("CRITICAL SAFETY VIOLATION"));
    }

    @Test
    @DisplayName("L-02: production profile with simulation enabled fails closed")
    void testProductionProfileWithSimulationThrowsException() {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> postProcessor.postProcessEnvironment(environment("true", "production"), application));
        assertTrue(ex.getMessage().contains("CRITICAL SAFETY VIOLATION"));
    }

    @Test
    @DisplayName("L-02: prod profile with simulation disabled allows startup")
    void testProdProfileWithSimulationDisabledAllowsStartup() {
        assertDoesNotThrow(() -> postProcessor.postProcessEnvironment(environment("false", "prod"), application));
    }

    @Test
    @DisplayName("L-02: multi-profile dev and prod with simulation enabled fails closed")
    void testMultiProfileDevAndProdThrowsException() {
        assertThrows(IllegalStateException.class,
                () -> postProcessor.postProcessEnvironment(environment("true", "dev", "prod"), application));
    }
}
