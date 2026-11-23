import { BaseScreen } from './base.screen.js';

import { AdminPreparationScreen } from './admin/preparation/admin-preparation.screen.js';
import { AdminPrepDateInputScreen } from './admin/preparation/admin-prep-date-input.screen.js';
import { AdminPrepLoadSubjectsScreen } from './admin/preparation/admin-prep-load-subjects.screen.js';
import { AdminPrepDeleteSubjectScreen } from './admin/preparation/admin-prep-delete-subject.screen.js';

import { AdminRegistrationScreen } from './admin/registration/admin-registration.screen.js';
import { AdminRegSelectSubjectScreen } from './admin/registration/admin-reg-select-subject.screen.js';
import { AdminRegSubjectEditorsScreen } from './admin/registration/admin-reg-subject-editors.screen.js';
import { AdminRegEditorFioInputScreen } from './admin/registration/admin-reg-editor-fio-input.screen.js';
import { AdminRegLoadSubjectsScreen } from './admin/registration/admin-reg-load-subjects.screen.js';
import { AdminRegDeleteSubjectScreen } from './admin/registration/admin-reg-delete-subject.screen.js';

import { AdminDistributionScreen } from './admin/distribution/admin-distribution.screen.js';
import { AdminDistStatsScreen } from './admin/distribution/admin-dist-stats.screen.js';
import { AdminDistSubjectsScreen } from './admin/distribution/admin-dist-subjects.screen.js';

import { AdminTicketingScreen } from './admin/ticketing/admin-ticketing.screen.js';
import { AdminTickFilesScreen } from './admin/ticketing/admin-tick-files.screen.js';
import { AdminTickBroadcastScreen } from './admin/ticketing/admin-tick-broadcast.screen.js';
import { AdminTickSheetsScreen } from './admin/ticketing/admin-tick-sheets.screen.js';

import { StudentRegFioInputScreen } from './student/registration/student-reg-fio-input.screen.js';
import { StudentRegistrationScreen } from './student/registration/student-registration.screen.js';
import { StudentRegSubjectSelectionScreen } from './student/registration/student-reg-subject-selection.screen.js';
import { StudentDistributionScreen } from './student/distribution/student-distribution.screen.js';
import { StudentTicketingScreen } from './student/ticketing/student-ticketing.screen.js';
import { StudentTicketSelectScreen } from './student/ticketing/student-ticket-select.screen.js';
import { StudentTicketSubmitScreen } from './student/ticketing/student-ticket-submit.screen.js';

import { EditorDistributionScreen } from './editor/distribution/editor-distribution.screen.js';
import { EditorTicketingScreen } from './editor/ticketing/editor-ticketing.screen.js';
import { EditorTicketReviewScreen } from './editor/ticketing/editor-ticket-review.screen.js';

/**
 * Фабрика экранов: сопоставляет строковый `screenId` из сессии с классом экрана.
 */
export class ScreenFactory {
  private readonly registry: Record<string, new () => BaseScreen> = {
    // Экраны Администратора: Подготовка
    admin_preparation: AdminPreparationScreen,
    admin_prep_date_input: AdminPrepDateInputScreen,
    admin_prep_load_subjects: AdminPrepLoadSubjectsScreen,
    admin_prep_delete_subject: AdminPrepDeleteSubjectScreen,

    // Экраны Администратора: Регистрация
    admin_registration: AdminRegistrationScreen,
    admin_reg_select_subject: AdminRegSelectSubjectScreen,
    admin_reg_subject_editors: AdminRegSubjectEditorsScreen,
    admin_reg_editor_fio_input: AdminRegEditorFioInputScreen,
    admin_reg_load_subjects: AdminRegLoadSubjectsScreen,
    admin_reg_delete_subject: AdminRegDeleteSubjectScreen,

    // Экраны Администратора: Распределение
    admin_distribution: AdminDistributionScreen,
    admin_dist_stats: AdminDistStatsScreen,
    admin_dist_subjects: AdminDistSubjectsScreen,

    // Экраны Администратора: Подготовка билетов и завершение
    admin_ticketing: AdminTicketingScreen,
    admin_finished: AdminTicketingScreen,
    admin_tick_files: AdminTickFilesScreen,
    admin_tick_broadcast: AdminTickBroadcastScreen,
    admin_tick_sheets: AdminTickSheetsScreen,

    // Экраны Студента
    student_reg_fio_input: StudentRegFioInputScreen,
    student_registration: StudentRegistrationScreen,
    student_reg_subject_selection: StudentRegSubjectSelectionScreen,
    student_distribution: StudentDistributionScreen,
    student_ticketing: StudentTicketingScreen,
    student_ticket_select: StudentTicketSelectScreen,
    student_ticket_submit: StudentTicketSubmitScreen,

    // Экраны Редактора
    editor_distribution: EditorDistributionScreen,
    editor_ticketing: EditorTicketingScreen,
    editor_ticket_review: EditorTicketReviewScreen,
  };

  /**
   * Создаёт экземпляр экрана по его идентификатору (по умолчанию — `AdminPreparationScreen`).
   */
  create(screenId?: string): BaseScreen {
    const ScreenClass = this.registry[screenId || 'admin_preparation'] || AdminPreparationScreen;
    return new ScreenClass();
  }
}

export const screenFactory = new ScreenFactory();

