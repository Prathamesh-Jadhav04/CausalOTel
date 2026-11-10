package com.causalotel.payment.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

import java.util.Set;

/**
 * Fail-closed pre-startup validator.
 * Ensures that payment simulation is strictly prohibited in production profiles.
 */
public class PaymentSimulationSafetyPostProcessor implements EnvironmentPostProcessor {

    private static final Set<String> FORBIDDEN_PROFILES = Set.of("prod", "production");

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String simEnabledVal = environment.getProperty("causalotel.payment.simulation.enabled", "true");
        boolean simulationEnabled = Boolean.parseBoolean(simEnabledVal);

        if (simulationEnabled) {
            String[] activeProfiles = environment.getActiveProfiles();
            for (String profile : activeProfiles) {
                if (FORBIDDEN_PROFILES.contains(profile.toLowerCase())) {
                    throw new IllegalStateException(
                        "CRITICAL SAFETY VIOLATION: Payment gateway simulation mode cannot be enabled when profile '" 
                        + profile + "' is active! Aborting startup to prevent simulated transactions in production."
                    );
                }
            }
        }
    }
}
