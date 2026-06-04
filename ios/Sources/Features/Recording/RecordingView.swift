import SwiftUI

/// The whole capture flow on one screen: name the property, then record the
/// walkthrough. The record⇄stop control lives in the functional layer and uses
/// Liquid Glass with a mic→stop symbol morph.
struct RecordingView: View {
    private enum Phase: Equatable {
        case setup
        case recording
        case saving
    }

    @Environment(JobSyncService.self) private var sync
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var recorder = AudioRecorder()
    @State private var phase: Phase = .setup
    @State private var label = ""
    @State private var startedAt: Date?
    @State private var elapsed: TimeInterval = 0
    @State private var level: Float = 0
    @State private var permissionDenied = false

    @Namespace private var glassNamespace
    @FocusState private var addressFocused: Bool

    /// Hard ceiling so a forgotten recording can't grow unbounded (server also caps).
    private let maxDuration: TimeInterval = 30 * 60

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()

            VStack(spacing: AppTheme.Spacing.xl) {
                header

                Spacer()

                if phase == .setup {
                    addressEntry
                } else {
                    recordingStatus
                }

                Spacer()

                controlButton
                    .padding(.bottom, AppTheme.Spacing.xl)
            }
            .padding(AppTheme.Spacing.lg)
        }
        .interactiveDismissDisabled(phase != .setup)
        .task(id: phase) { await runMeteringLoop() }
        .alert("Microphone Access Needed", isPresented: $permissionDenied) {
            Button("Open Settings") { openSettings() }
            Button("Cancel", role: .cancel) { dismiss() }
        } message: {
            Text("Enable microphone access in Settings to record a walkthrough.")
        }
        .onAppear { addressFocused = true }
    }

    // MARK: - Sections

    private var header: some View {
        HStack {
            Button {
                cancelAndDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.headline)
            }
            .buttonStyle(.glass)
            .clipShape(Circle())
            .accessibilityLabel("Cancel")

            Spacer()
        }
    }

    private var addressEntry: some View {
        VStack(spacing: AppTheme.Spacing.md) {
            Text("New Report")
                .font(.largeTitle.bold())
            Text("What's the address?")
                .font(.headline)
                .foregroundStyle(.secondary)

            TextField("123 Main St", text: $label)
                .font(.title3)
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .focused($addressFocused)
                .padding(AppTheme.Spacing.md)
                .background(AppTheme.card, in: RoundedRectangle(cornerRadius: AppTheme.Radius.control))
                .padding(.horizontal, AppTheme.Spacing.md)
        }
    }

    private var recordingStatus: some View {
        VStack(spacing: AppTheme.Spacing.lg) {
            Text(label)
                .font(.title2.bold())
                .multilineTextAlignment(.center)

            Text(timeString(elapsed))
                .font(.system(size: 56, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .foregroundStyle(phase == .saving ? .secondary : .primary)

            LevelMeter(level: level, isActive: phase == .recording)
                .frame(height: 48)
                .padding(.horizontal, AppTheme.Spacing.xl)

            Text(phase == .saving ? "Saving your report…" : "Recording — describe what you see.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var controlButton: some View {
        GlassEffectContainer {
            Button {
                handleControlTap()
            } label: {
                Image(systemName: controlSymbol)
                    .font(.system(size: 40, weight: .bold))
                    .frame(width: 96, height: 96)
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(.glassProminent)
            .clipShape(Circle())
            .tint(phase == .recording ? .red : AppTheme.accent)
            .glassEffectID("record-control", in: glassNamespace)
            .disabled(phase == .saving || (phase == .setup && trimmedLabel.isEmpty))
            .scaleEffect(phase == .recording && !reduceMotion && pulse ? 1.06 : 1)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
                value: pulse
            )
            .accessibilityLabel(phase == .recording ? "Stop recording" : "Start recording")
        }
    }

    // MARK: - Derived

    private var trimmedLabel: String {
        label.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var controlSymbol: String {
        switch phase {
        case .setup: return "mic.fill"
        case .recording: return "stop.fill"
        case .saving: return "hourglass"
        }
    }

    @State private var pulse = false

    // MARK: - Actions

    private func handleControlTap() {
        switch phase {
        case .setup:
            Task { await startRecording() }
        case .recording:
            Task { await stopRecording() }
        case .saving:
            break
        }
    }

    private func startRecording() async {
        let now = Date()
        do {
            _ = try await recorder.start(now: now)
            startedAt = now
            elapsed = 0
            addressFocused = false
            Haptics.impact(.medium)
            withAnimation(.smooth) { phase = .recording }
            pulse = true
        } catch let error as AudioRecorder.RecorderError {
            if case .permissionDenied = error {
                permissionDenied = true
            } else {
                sync.errorMessage = error.errorDescription
                dismiss()
            }
        } catch {
            sync.errorMessage = error.localizedDescription
            dismiss()
        }
    }

    private func stopRecording() async {
        pulse = false
        let now = Date()
        do {
            let result = try await recorder.stop(now: now)
            Haptics.notify(.success)
            withAnimation(.smooth) { phase = .saving }
            await sync.startReport(label: trimmedLabel, recording: result, now: now)
            dismiss()
        } catch {
            sync.errorMessage = error.localizedDescription
            dismiss()
        }
    }

    private func cancelAndDismiss() {
        Task {
            await recorder.cancel()
            dismiss()
        }
    }

    /// Polls input level and elapsed time while recording; auto-stops at the cap.
    private func runMeteringLoop() async {
        guard phase == .recording else { return }
        while !Task.isCancelled, phase == .recording {
            level = await recorder.currentLevel()
            if let startedAt {
                elapsed = Date().timeIntervalSince(startedAt)
                if elapsed >= maxDuration {
                    await stopRecording()
                    return
                }
            }
            try? await Task.sleep(nanoseconds: 80_000_000)
        }
    }

    private func timeString(_ interval: TimeInterval) -> String {
        let total = Int(interval)
        return String(format: "%02d:%02d", total / 60, total % 60)
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
        dismiss()
    }
}

/// Simple reactive level meter for the recording screen (content layer).
private struct LevelMeter: View {
    let level: Float
    let isActive: Bool

    private let barCount = 28

    var body: some View {
        GeometryReader { proxy in
            HStack(spacing: 3) {
                ForEach(0..<barCount, id: \.self) { index in
                    Capsule()
                        .fill(barColor(index))
                        .frame(height: barHeight(index, in: proxy.size.height))
                        .frame(maxHeight: .infinity, alignment: .center)
                }
            }
        }
        .animation(.easeOut(duration: 0.1), value: level)
        .accessibilityHidden(true)
    }

    private func barHeight(_ index: Int, in maxHeight: CGFloat) -> CGFloat {
        guard isActive else { return 3 }
        // Center bars react more strongly than edges for an organic shape.
        let distanceFromCenter = abs(Double(index) - Double(barCount) / 2) / (Double(barCount) / 2)
        let envelope = 1 - distanceFromCenter * 0.7
        let magnitude = CGFloat(Double(level) * envelope)
        return max(3, maxHeight * magnitude)
    }

    private func barColor(_ index: Int) -> Color {
        isActive ? AppTheme.accent.opacity(0.85) : Color(.tertiaryLabel)
    }
}
