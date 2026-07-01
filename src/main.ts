import { App, BasesAllOptions, BasesViewConfig, Plugin, PluginSettingTab, Setting } from 'obsidian'
import { GroupCardsView, GroupTableView, VIEW_TYPE, VIEW_TYPE_CARDS } from './bases-view'
import { CHANGELOG, ChangelogModal } from './changelog'

// Plugin data.json shape (separate from the per-view .base config).
interface PluginData {
  lastVersion?: string
  showChangelog?: boolean
}

export default class CollapsingGroupTablePlugin extends Plugin {
  data: PluginData = {}

  async onload() {
    // loadData() is typed `any`; read known fields defensively into our shape
    // rather than assigning the any value directly.
    const raw = (await this.loadData()) as Record<string, unknown> | null
    this.data = {}
    if (raw && typeof raw.lastVersion === 'string') this.data.lastVersion = raw.lastVersion
    if (raw && typeof raw.showChangelog === 'boolean') this.data.showChangelog = raw.showChangelog
    this.addSettingTab(new CgtSettingTab(this.app, this))
    // Show "what's new" once after an update (not on first install), if enabled.
    const current = this.manifest.version
    if (this.data.lastVersion !== current) {
      if (this.data.lastVersion && this.data.showChangelog !== false) {
        new ChangelogModal(this.app, this, CHANGELOG).open()
      }
      this.data.lastVersion = current
      await this.saveData(this.data)
    }

    // The grouping/nesting options, shared by both views, as one collapsible
    // group. `splitOn` makes the "/" split and the column pickers exclusive.
    const groupingGroup = (config: BasesViewConfig): BasesAllOptions => {
      const splitOn = (): boolean => config.get('subGroup') === true
      return {
        type: 'group',
        displayName: 'Grouping & nesting',
        items: [
          {
            type: 'toggle',
            displayName: 'Accordion mode (expand only one group)',
            key: 'accordion',
            default: false,
          },
          {
            type: 'toggle',
            displayName: 'Start with groups collapsed',
            key: 'startCollapsed',
            default: false,
          },
          {
            type: 'toggle',
            displayName: 'Show entry count on group headers',
            key: 'showCount',
            default: true,
          },
          {
            type: 'toggle',
            displayName: 'Split groupBy value on "/" to nest',
            key: 'subGroup',
            default: false,
          },
          {
            type: 'property',
            displayName: 'Sub-group by (2nd level)',
            key: 'subCol1',
            shouldHide: () => splitOn(),
          },
          {
            type: 'property',
            displayName: 'Sub-group by (3rd level)',
            key: 'subCol2',
            shouldHide: () => splitOn() || !config.getAsPropertyId('subCol1'),
          },
          {
            type: 'dropdown',
            displayName: 'When opening a group',
            key: 'openBehavior',
            default: 'first',
            options: {
              first: 'Open first sub-group',
              all: 'Open all sub-groups',
              none: 'Open no sub-groups',
            },
          },
        ],
      }
    }

    // Context-specific options (only relevant when nesting is on).
    const situationalGroup = (config: BasesViewConfig): BasesAllOptions => ({
      type: 'group',
      displayName: 'Situational options',
      shouldHide: () => config.get('subGroup') !== true,
      items: [
        {
          type: 'text',
          displayName: 'Strip prefix from values (a literal path, or a formula like this.file.folder)',
          key: 'stripPrefix',
          default: '',
          placeholder: 'this.file.folder',
        },
      ],
    })

    this.registerBasesView(VIEW_TYPE, {
      name: 'Collapsing group table',
      icon: 'lucide-list-tree',
      factory: (controller, containerEl) => new GroupTableView(controller, containerEl),
      options: (config: BasesViewConfig): BasesAllOptions[] => [
        {
          type: 'group',
          displayName: 'Table',
          items: [
            {
              type: 'dropdown',
              displayName: 'Row height',
              key: 'rowHeight',
              default: 'short',
              options: {
                short: 'Short (1 line)',
                medium: 'Medium (3 lines)',
                tall: 'Tall (6 lines)',
                extra: 'Extra tall (12 lines)',
                dynamic: 'Dynamic height',
              },
            },
            {
              type: 'text',
              displayName: 'Date format (moment tokens, e.g. YYYY-MM-DD)',
              key: 'dateFormat',
              default: '',
              placeholder: 'YYYY-MM-DD',
            },
          ],
        },
        groupingGroup(config),
        situationalGroup(config),
      ],
    })

    this.registerBasesView(VIEW_TYPE_CARDS, {
      name: 'Collapsing group cards',
      icon: 'lucide-layout-grid',
      factory: (controller, containerEl) => new GroupCardsView(controller, containerEl),
      options: (config: BasesViewConfig): BasesAllOptions[] => [
        {
          type: 'group',
          displayName: 'Cards',
          items: [
            {
              type: 'property',
              displayName: 'Card image property',
              key: 'cardImage',
            },
            {
              type: 'slider',
              displayName: 'Card width (px)',
              key: 'cardWidth',
              default: 240,
              min: 120,
              max: 500,
            },
            {
              type: 'dropdown',
              displayName: 'Filename',
              key: 'cardTitle',
              default: 'show',
              options: {
                show: 'Show below image',
                hide: 'Hide',
                overlay: 'Overlay on image (on hover)',
              },
            },
            {
              type: 'dropdown',
              displayName: 'Image fit',
              key: 'cardFit',
              default: 'cover',
              options: {
                cover: 'Cover (crop to fill)',
                contain: 'Contain (whole image)',
              },
            },
            {
              type: 'slider',
              displayName: 'Image aspect ratio (height ÷ width; 0 = natural)',
              key: 'cardAspect',
              default: 0,
              min: 0,
              max: 3,
              step: 0.05,
            },
            {
              type: 'text',
              displayName: 'Date format (moment tokens, e.g. YYYY-MM-DD)',
              key: 'dateFormat',
              default: '',
              placeholder: 'YYYY-MM-DD',
            },
          ],
        },
        groupingGroup(config),
        situationalGroup(config),
      ],
    })
  }

  onunload() {}
}

class CgtSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: CollapsingGroupTablePlugin,
  ) {
    super(app, plugin)
  }

  display(): void {
    this.containerEl.empty()
    new Setting(this.containerEl)
      .setName("Show what's new on update")
      .setDesc('Open a changelog popup the first time you run a new version.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.data.showChangelog !== false).onChange(async (value) => {
          this.plugin.data.showChangelog = value
          await this.plugin.saveData(this.plugin.data)
        }),
      )
    new Setting(this.containerEl).setName('View changelog').addButton((btn) =>
      btn.setButtonText('Open').onClick(() => {
        new ChangelogModal(this.app, this.plugin, CHANGELOG).open()
      }),
    )
  }
}
