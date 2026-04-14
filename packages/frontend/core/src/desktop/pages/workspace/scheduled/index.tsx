import { ViewBody, ViewIcon, ViewTitle } from '../../../../modules/workbench';
import { ScheduledPage } from './scheduled-page';

export const Component = () => {
  return (
    <>
      <ViewTitle title="Scheduled" />
      <ViewIcon icon="scheduled" />
      <ViewBody>
        <ScheduledPage />
      </ViewBody>
    </>
  );
};
