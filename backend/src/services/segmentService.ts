import { ActivityTypeSettings, PlatformType } from '@crowd/types'
import { LoggerBase } from '@crowd/logging'
import SegmentRepository from '../database/repositories/segmentRepository'
import SequelizeRepository from '../database/repositories/sequelizeRepository'
import Error400 from '../errors/Error400'
import {
  SegmentActivityTypesCreateData,
  SegmentCriteria,
  SegmentData,
  SegmentLevel,
  SegmentUpdateData,
} from '../types/segmentTypes'
import { IServiceOptions } from './IServiceOptions'

interface UnnestedActivityTypes {
  [key: string]: any
}
export default class SegmentService extends LoggerBase {
  options: IServiceOptions

  constructor(options: IServiceOptions) {
    super(options)
    this.options = options
  }

  async update(id: string, data: SegmentUpdateData): Promise<SegmentData> {
    const segment = await this.findById(id)

    const transaction = await SequelizeRepository.createTransaction(this.options)

    try {
      const segmentRepository = new SegmentRepository({ ...this.options, transaction })

      // do the update
      await segmentRepository.update(id, data)

      // update relation fields of parent objects
      if (!SegmentRepository.isSubproject(segment) && (data.name || data.slug)) {
        await segmentRepository.updateChildrenBulk(segment.id, { name: data.name, slug: data.slug })
      }

      await SequelizeRepository.commitTransaction(transaction)

      return await this.findById(id)
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction.transaction)
      throw error
    }
  }

  async createProjectGroup(data: SegmentData): Promise<SegmentData> {
    // project groups shouldn't have parentSlug or grandparentSlug
    if (data.parentSlug || data.grandparentSlug) {
      throw new Error(`Project groups can't have parent or grandparent segments.`)
    }

    const transaction = await SequelizeRepository.createTransaction(this.options)

    try {
      const segmentRepository = new SegmentRepository({ ...this.options, transaction })

      // create project group
      const projectGroup = await segmentRepository.create(data)

      // create project counterpart
      await segmentRepository.create({ ...data, parentSlug: data.slug, parentName: data.name })

      // create subproject counterpart
      await segmentRepository.create({
        ...data,
        parentSlug: data.slug,
        grandparentSlug: data.slug,
        parentName: data.name,
        grandparentName: data.name,
      })

      await SequelizeRepository.commitTransaction(transaction)

      return await this.findById(projectGroup.id)
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction.transaction)
      throw error
    }
  }

  async createProject(data: SegmentData): Promise<SegmentData> {
    // project groups shouldn't have parentSlug or grandparentSlug
    if (data.grandparentSlug) {
      throw new Error(`Projects can't have grandparent segments.`)
    }

    if (!data.parentSlug) {
      throw new Error('Missing parentSlug. Projects must belong to a project group.')
    }
    const transaction = await SequelizeRepository.createTransaction(this.options)

    const segmentRepository = new SegmentRepository({ ...this.options, transaction })

    const parent = await segmentRepository.findBySlug(data.parentSlug, SegmentLevel.PROJECT_GROUP)

    if (parent === null) {
      throw new Error(`Project group ${data.parentName} does not exist.`)
    }

    try {
      // create project
      const project = await segmentRepository.create(data)

      // create subproject counterpart
      await segmentRepository.create({
        ...data,
        parentSlug: data.slug,
        grandparentSlug: data.parentSlug,
        name: data.name,
        parentName: data.name,
      })

      await SequelizeRepository.commitTransaction(transaction)

      return await this.findById(project.id)
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction.transaction)
      throw error
    }
  }

  async createSubproject(data: SegmentData): Promise<SegmentData> {
    if (!data.parentSlug) {
      throw new Error('Missing parentSlug. Subprojects must belong to a project.')
    }

    if (!data.grandparentSlug) {
      throw new Error('Missing grandparentSlug. Subprojects must belong to a project group.')
    }

    const segmentRepository = new SegmentRepository(this.options)

    const subproject = await segmentRepository.create(data)

    return this.findById(subproject.id)
  }

  async findById(id) {
    return new SegmentRepository(this.options).findById(id)
  }

  async queryProjectGroups(search: SegmentCriteria) {
    return new SegmentRepository(this.options).queryProjectGroups(search)
  }

  async queryProjects(search: SegmentCriteria) {
    return new SegmentRepository(this.options).queryProjects(search)
  }

  async querySubprojects(search: SegmentCriteria) {
    return new SegmentRepository(this.options).querySubprojects(search)
  }

  async createActivityType(
    data: SegmentActivityTypesCreateData,
    platform: string = PlatformType.OTHER,
  ): Promise<ActivityTypeSettings> {
    if (!data.type) {
      throw new Error400(
        this.options.language,
        'settings.activityTypes.errors.typeRequiredWhenCreating',
      )
    }

    const segment = SequelizeRepository.getStrictlySingleActiveSegment(this.options)

    const typeKey = data.type.toLowerCase()
    const platformKey = platform.toLowerCase()

    const activityTypes = SegmentRepository.getActivityTypes(this.options)

    if (!activityTypes.custom[platformKey]) {
      activityTypes.custom[platformKey] = {}
    }

    // check key already exists
    if (activityTypes.custom && activityTypes.custom[platformKey][typeKey]) {
      return activityTypes
    }

    activityTypes.custom[platformKey][typeKey] = {
      display: {
        default: data.type,
        short: data.type,
        channel: '',
      },
      isContribution: false,
    }

    const updated = await new SegmentRepository(this.options).update(segment.id, {
      customActivityTypes: activityTypes.custom,
    })

    return updated.activityTypes
  }

  /**
   * unnest activity types with platform for easy access/manipulation
   * custom : {
   *    platform: {
   *         type1: settings1,
   *         type2: settings2
   *    }
   * }
   *
   * is transformed into
   * {
   *    type1: {...settings1, platform},
   *    type2: {...settings2, platform}
   * }
   *
   */
  static unnestActivityTypes(activityTypes: ActivityTypeSettings): UnnestedActivityTypes {
    return Object.keys(activityTypes.custom)
      .filter((k) => activityTypes.custom[k])
      .reduce((acc, platform) => {
        const unnestWithPlatform = Object.keys(activityTypes.custom[platform]).reduce(
          (acc2, key) => {
            acc2[key] = { ...activityTypes.custom[platform][key], platform }
            return acc2
          },
          {},
        )

        acc = { ...acc, ...unnestWithPlatform }
        return acc
      }, {})
  }

  async updateActivityType(key: string, data) {
    if (!data.type) {
      throw new Error400(
        this.options.language,
        'settings.activityTypes.errors.typeRequiredWhenUpdating',
      )
    }

    const segment = SequelizeRepository.getStrictlySingleActiveSegment(this.options)

    const activityTypes = SegmentRepository.getActivityTypes(this.options)

    const activityTypesUnnested = SegmentService.unnestActivityTypes(activityTypes)

    // if key doesn't exist, throw 400
    if (!activityTypesUnnested[key]) {
      throw new Error400(this.options.language, 'settings.activityTypes.errors.notFound', key)
    }

    activityTypes.custom[activityTypesUnnested[key].platform][key] = {
      display: {
        default: data.type,
        short: data.type,
        channel: '',
      },
      isContribution: false,
    }

    const updated = await new SegmentRepository(this.options).update(segment.id, {
      customActivityTypes: activityTypes.custom,
    })

    return updated.activityTypes
  }

  async destroyActivityType(key: string): Promise<ActivityTypeSettings> {
    const activityTypes = SegmentRepository.getActivityTypes(this.options)

    const segment = SequelizeRepository.getStrictlySingleActiveSegment(this.options)

    const activityTypesUnnested = SegmentService.unnestActivityTypes(activityTypes)

    if (activityTypesUnnested[key]) {
      delete activityTypes.custom[activityTypesUnnested[key].platform][key]
      const updated = await new SegmentRepository(this.options).update(segment.id, {
        customActivityTypes: activityTypes.custom,
      })
      return updated.activityTypes
    }

    return activityTypes
  }

  static listActivityTypes(options): ActivityTypeSettings {
    return SegmentRepository.getActivityTypes(options)
  }

  /**
   * update activity channels after checking for duplicates with platform key
   */
  async updateActivityChannels(data) {
    if (!data.channel) {
      throw new Error400(
        this.options.language,
        'settings.activityChannels.errors.typeRequiredWhenCreating',
      )
    }

    const segment = SequelizeRepository.getStrictlySingleActiveSegment(this.options)

    const activityChannels = SegmentRepository.getActivityChannels(this.options)

    if (activityChannels[data.platform]) {
      const channelList = activityChannels[data.platform]
      if (!channelList.includes(data.channel)) {
        const updatedChannelList = [...channelList, data.channel]
        activityChannels[data.platform] = updatedChannelList
      }
    } else {
      activityChannels[data.platform] = [data.channel]
    }

    const updated = await new SegmentRepository(this.options).update(segment.id, {
      activityChannels,
    })

    return updated.activityChannels
  }
}
