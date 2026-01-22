import { NavigationPaneCalendar } from './NavigationPaneCalendar';

export function CalendarRightPanel() {
    return (
        <div className="nn-calendar-right-panel nn-list-pane">
            <div className="nn-calendar-right-panel-content">
                <NavigationPaneCalendar layout="panel" weeksToShowOverride={6} />
            </div>
        </div>
    );
}
