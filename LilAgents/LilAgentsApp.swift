import SwiftUI
import AppKit
import Sparkle

@main
struct LilAgentsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: LilAgentsController?
    var statusItem: NSStatusItem?
    let updaterController = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        controller = LilAgentsController()
        controller?.start()
        setupMenuBar()
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller?.characters.forEach { $0.session?.terminate() }
    }

    // MARK: - Menu Bar

    func setupMenuBar() {
        if statusItem == nil {
            statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        }
        if let button = statusItem?.button {
            let menuIcon = NSImage(named: "MenuBarIcon") ?? NSImage(systemSymbolName: "figure.walk", accessibilityDescription: "GaoTa Deskpet")
            menuIcon?.isTemplate = false
            button.image = menuIcon
        }

        let menu = NSMenu()

        let char1Item = NSMenuItem(title: "显示桌宠", action: #selector(toggleChar1), keyEquivalent: "1")
        char1Item.state = .on
        menu.addItem(char1Item)

        let returnToBottomItem = NSMenuItem(title: "回到桌面底部", action: #selector(returnPetToDesktopBottom), keyEquivalent: "")
        menu.addItem(returnToBottomItem)

        menu.addItem(NSMenuItem.separator())

        let soundItem = NSMenuItem(title: "声音", action: #selector(toggleSounds(_:)), keyEquivalent: "")
        soundItem.state = .on
        menu.addItem(soundItem)

        // Provider submenu (applies to all characters)
        let providerItem = NSMenuItem(title: "AI 服务", action: nil, keyEquivalent: "")
        let providerMenu = NSMenu()
        let currentProvider = controller?.characters.first?.provider ?? .claude
        for (i, provider) in AgentProvider.allCases.enumerated() {
            let item = NSMenuItem(title: provider.displayName, action: #selector(switchProvider(_:)), keyEquivalent: "")
            item.tag = i
            item.state = provider == currentProvider ? .on : .off
            if !provider.isAvailable {
                item.isEnabled = false
            }
            providerMenu.addItem(item)
        }
        providerMenu.addItem(NSMenuItem.separator())
        let gatewayItem = NSMenuItem(title: "高级设置…", action: #selector(openGatewaySettings), keyEquivalent: "")
        gatewayItem.tag = -1
        providerMenu.addItem(gatewayItem)

        providerItem.submenu = providerMenu
        menu.addItem(providerItem)

        let doubaoSettingsItem = NSMenuItem(title: "豆包 API 设置…", action: #selector(openDoubaoSettings), keyEquivalent: "")
        menu.addItem(doubaoSettingsItem)

        // Size submenu (applies to all characters)
        let sizeItem = NSMenuItem(title: "大小", action: nil, keyEquivalent: "")
        let sizeMenu = NSMenu()
        let currentSize = controller?.characters.first?.size ?? .large
        for (i, size) in CharacterSize.allCases.enumerated() {
            let item = NSMenuItem(title: size.displayName, action: #selector(switchCharacterSize(_:)), keyEquivalent: "")
            item.tag = i
            item.state = size == currentSize ? .on : .off
            sizeMenu.addItem(item)
        }
        sizeItem.submenu = sizeMenu
        menu.addItem(sizeItem)

        // Theme submenu
        let themeItem = NSMenuItem(title: "样式", action: nil, keyEquivalent: "")
        let themeMenu = NSMenu()
        for (i, theme) in PopoverTheme.allThemes.enumerated() {
            let item = NSMenuItem(title: theme.displayName, action: #selector(switchTheme(_:)), keyEquivalent: "")
            item.tag = i
            item.state = theme.name == PopoverTheme.current.name ? .on : .off
            themeMenu.addItem(item)
        }
        themeItem.submenu = themeMenu
        menu.addItem(themeItem)

        // Display submenu
        let displayItem = NSMenuItem(title: "显示器", action: nil, keyEquivalent: "")
        let displayMenu = NSMenu()
        displayMenu.delegate = self
        let autoItem = NSMenuItem(title: "自动（主显示器）", action: #selector(switchDisplay(_:)), keyEquivalent: "")
        autoItem.tag = -1
        autoItem.state = .on
        displayMenu.addItem(autoItem)
        displayMenu.addItem(NSMenuItem.separator())
        for (i, screen) in NSScreen.screens.enumerated() {
            let name = screen.localizedName
            let item = NSMenuItem(title: name, action: #selector(switchDisplay(_:)), keyEquivalent: "")
            item.tag = i
            item.state = .off
            displayMenu.addItem(item)
        }
        displayItem.submenu = displayMenu
        menu.addItem(displayItem)

        menu.addItem(NSMenuItem.separator())

        let updateItem = NSMenuItem(title: "检查更新…", action: #selector(SPUStandardUpdaterController.checkForUpdates(_:)), keyEquivalent: "")
        updateItem.target = updaterController
        menu.addItem(updateItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "退出", action: #selector(quitApp), keyEquivalent: "q")
        menu.addItem(quitItem)

        statusItem?.menu = menu
    }

    // MARK: - Menu Actions

    @objc func switchTheme(_ sender: NSMenuItem) {
        let idx = sender.tag
        guard idx < PopoverTheme.allThemes.count else { return }
        PopoverTheme.current = PopoverTheme.allThemes[idx]

        if let themeMenu = sender.menu {
            for item in themeMenu.items {
                item.state = item.tag == idx ? .on : .off
            }
        }

        controller?.characters.forEach { char in
            let wasOpen = char.isIdleForPopover
            if wasOpen { char.popoverWindow?.orderOut(nil) }
            char.popoverWindow = nil
            char.terminalView = nil
            char.thinkingBubbleWindow = nil
            if wasOpen {
                char.createPopoverWindow()
                if let session = char.session, !session.history.isEmpty {
                    char.terminalView?.replayHistory(session.history)
                }
                char.updatePopoverPosition()
                char.popoverWindow?.orderFrontRegardless()
                char.popoverWindow?.makeKey()
                if let terminal = char.terminalView {
                    char.popoverWindow?.makeFirstResponder(terminal.inputField)
                }
            }
        }
    }

    @objc func switchProvider(_ sender: NSMenuItem) {
        let idx = sender.tag
        let allProviders = AgentProvider.allCases
        guard idx < allProviders.count else { return }
        let newProvider = allProviders[idx]

        controller?.characters.forEach { char in
            if char.provider == newProvider { return }
            char.provider = newProvider
            char.session?.terminate()
            char.session = nil
            char.popoverWindow?.orderOut(nil)
            char.popoverWindow = nil
            char.terminalView = nil
            char.thinkingBubbleWindow?.orderOut(nil)
            char.thinkingBubbleWindow = nil
        }

        if let providerMenu = sender.menu {
            for item in providerMenu.items {
                item.state = item.tag == idx ? .on : .off
            }
        }
    }

    @objc func switchCharacterSize(_ sender: NSMenuItem) {
        let idx = sender.tag
        let allSizes = CharacterSize.allCases
        guard idx < allSizes.count else { return }
        let newSize = allSizes[idx]

        controller?.characters.forEach { $0.size = newSize }

        if let sizeMenu = sender.menu {
            for item in sizeMenu.items {
                item.state = item.tag == idx ? .on : .off
            }
        }
    }

    @objc func switchDisplay(_ sender: NSMenuItem) {
        let idx = sender.tag
        controller?.pinnedScreenIndex = idx

        if let displayMenu = sender.menu {
            for item in displayMenu.items {
                item.state = item.tag == idx ? .on : .off
            }
        }
    }

    @objc func toggleChar1(_ sender: NSMenuItem) {
        guard let chars = controller?.characters, chars.count > 0 else { return }
        let char = chars[0]
        if char.isManuallyVisible {
            char.setManuallyVisible(false)
            sender.state = .off
        } else {
            char.setManuallyVisible(true)
            sender.state = .on
        }
    }

    @objc func toggleChar2(_ sender: NSMenuItem) {
        guard let chars = controller?.characters, chars.count > 1 else { return }
        let char = chars[1]
        if char.isManuallyVisible {
            char.setManuallyVisible(false)
            sender.state = .off
        } else {
            char.setManuallyVisible(true)
            sender.state = .on
        }
    }

    @objc func toggleSounds(_ sender: NSMenuItem) {
        WalkerCharacter.soundsEnabled.toggle()
        sender.state = WalkerCharacter.soundsEnabled ? .on : .off
    }

    @objc func returnPetToDesktopBottom() {
        controller?.characters.forEach { $0.returnToDesktopBottom() }
    }

    @objc func openGatewaySettings() {
        OpenClawSession.showSettingsPanel { [weak self] in
            // If OpenClaw is the active provider, reconnect with new settings
            guard AgentProvider.current == .openclaw else { return }
            self?.controller?.characters.forEach { char in
                char.session?.terminate()
                char.session = nil
            }
        }
    }

    @objc func openDoubaoSettings() {
        DoubaoSession.showSettingsPanel { [weak self] in
            AgentProvider.detectAvailableProviders { [weak self] in
                self?.controller?.characters.forEach { char in
                    if char.provider == .doubao {
                        char.session?.terminate()
                        char.session = nil
                        char.popoverWindow?.orderOut(nil)
                        char.popoverWindow = nil
                        char.terminalView = nil
                        char.thinkingBubbleWindow?.orderOut(nil)
                        char.thinkingBubbleWindow = nil
                    }
                }
                self?.setupMenuBar()
            }
        }
    }

    @objc func quitApp() {
        NSApp.terminate(nil)
    }
}

extension AppDelegate: NSMenuDelegate {}
