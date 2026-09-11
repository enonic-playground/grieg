import com.github.gradle.node.pnpm.task.PnpmInstallTask
import com.github.gradle.node.pnpm.task.PnpmTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.enonic.defaults)
    alias(libs.plugins.enonic.xp.app)
    alias(libs.plugins.node.gradle)
    alias(libs.plugins.kotlin.jvm)
}

val appName: String by project
val xpVersion: String by project

app {
    name = appName
    systemVersion = xpVersion
    scriptEngine = "GraalJS"
}

dependencies {
    implementation("com.enonic.xp:core-api:${xpVersion}")
    implementation("com.enonic.xp:admin-api:${xpVersion}")
    implementation("com.enonic.xp:portal-api:${xpVersion}")
    include(libs.kotlin.stdlib)
    include("com.enonic.xp:lib-admin:${xpVersion}")
    include("com.enonic.xp:lib-portal:${xpVersion}")
    include("com.enonic.xp:lib-node:${xpVersion}")
    include("com.enonic.xp:lib-repo:${xpVersion}")
    include("com.enonic.xp:lib-content:${xpVersion}")
    include("com.enonic.xp:lib-auth:${xpVersion}")
    include("com.enonic.xp:lib-context:${xpVersion}")
    include("com.enonic.xp:lib-scheduler:${xpVersion}")
    include("com.enonic.xp:lib-task:${xpVersion}")
    include("com.enonic.xp:lib-i18n:${xpVersion}")
    include("com.enonic.lib:lib-mustache:3.0.0")

    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

repositories {
    mavenLocal()
    mavenCentral()
    xp.enonicRepo()
}

node {
    download = true
    version = "24.18.0"
    pnpmVersion = "11.15.1"
}

fun isProd(): Boolean =
    providers.gradleProperty("env").getOrElse("prod") in setOf("p", "prod", "production")

fun environmentShort(): String = if (isProd()) "prod" else "dev"

fun nodeEnvironment(): String = if (isProd()) "production" else "development"

tasks.named<PnpmInstallTask>("pnpmInstall") {
    if (System.getenv("CI") != null) {
        args.addAll("--frozen-lockfile")
    }
}

tasks.register<PnpmTask>("pnpmBuild") {
    dependsOn(tasks.named("pnpmInstall"))
    description = "Build UI assets with Vite"
    args = listOf("run", "build:${environmentShort()}")
    environment = mapOf(
        "FORCE_COLOR" to "true",
        "NODE_ENV" to nodeEnvironment()
    )
    inputs.dir("src/main/resources")
    outputs.dir("build/resources/main")
    outputs.upToDateWhen { false }
}

tasks.register<PnpmTask>("pnpmCheck") {
    dependsOn(tasks.named("pnpmInstall"))
    args = listOf("run", "check")
    environment = mapOf("FORCE_COLOR" to "true")
}

tasks.named("jar") {
    dependsOn(tasks.named("pnpmBuild"))
}

tasks.named("check") {
    dependsOn(tasks.named("pnpmCheck"))
}

tasks.test {
    useJUnitPlatform()
}

tasks.named<ProcessResources>("processResources") {
    exclude("**/.gitkeep")
    exclude("assets/js/**")
    exclude("assets/styles/**")
    exclude("**/*.ts")
    exclude("**/*.tsx")
    exclude("**/tsconfig.json")
    includeEmptyDirs = false
}

tasks.withType<Copy>().configureEach {
    includeEmptyDirs = false
}

tasks.withType<KotlinCompile>().configureEach {
    val javaTarget = tasks.named<JavaCompile>("compileJava").get().targetCompatibility

    compilerOptions {
        jvmTarget.set(JvmTarget.fromTarget(javaTarget))
    }
}
