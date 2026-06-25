import { BasesAllOptions, BasesViewConfig, Plugin } from 'obsidian'
import { GroupTableView, VIEW_TYPE } from './bases-view'

export default class CollapsingGroupTablePlugin extends Plugin {
  async onload() {
    this.registerBasesView(VIEW_TYPE, {
      name: 'Collapsing group table',
      icon: 'lucide-list-tree',
      factory: (controller, containerEl) => new GroupTableView(controller, containerEl),
      options: (config: BasesViewConfig): BasesAllOptions[] => {
        // The "/" split and the column pickers are mutually exclusive: when the
        // split toggle is on, hide (and ignore) the column pickers.
        const splitOn = (): boolean => config.get('subGroup') === true
        return [
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
            displayName: 'Split group value on "/" into nested groups',
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
          {
            type: 'text',
            displayName: 'Date format (moment tokens, e.g. YYYY-MM-DD)',
            key: 'dateFormat',
            default: '',
            placeholder: 'YYYY-MM-DD',
          },
        ]
      },
    })
  }

  onunload() {}
}
