ARG JAVA_VERSION=25
FROM eclipse-temurin:${JAVA_VERSION}-jdk AS build
ARG SERVICE
WORKDIR /workspace
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY services/${SERVICE}/.mvn services/${SERVICE}/.mvn
COPY services/${SERVICE}/mvnw services/${SERVICE}/pom.xml services/${SERVICE}/
COPY services/${SERVICE}/src services/${SERVICE}/src
RUN sed -i 's/\r$//' services/${SERVICE}/mvnw \
    && chmod +x services/${SERVICE}/mvnw \
    && services/${SERVICE}/mvnw -f services/${SERVICE}/pom.xml -DskipTests package

FROM eclipse-temurin:${JAVA_VERSION}-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 causalotel
COPY --from=build /workspace/services/${SERVICE}/target/*.jar app.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
