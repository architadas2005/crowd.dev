import HackerNewsConnect from './components/hackerNews-connect'
import HackerNewsActivityMessage from './components/activity/hackerNews-activity-message'
import HackerNewsActivityContent from './components/activity/hackerNews-activity-content'

export default {
  enabled: true,
  name: 'Hacker News',
  backgroundColor: '#E5E7EB',
  borderColor: '#E5E7EB',
  description:
    'Connect Hacker News to get posts as well as their comments mentioning your community.',
  image: '/images/hackernews.svg',
  connectComponent: HackerNewsConnect,
  activityMessage: HackerNewsActivityMessage,
  activityContent: HackerNewsActivityContent
}